package com.pdfsplitter.app

import android.app.AlertDialog
import android.content.ComponentName
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64 as AndroidBase64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.JsResult
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import java.io.File
import java.io.FileOutputStream
import org.json.JSONObject

/**
 * 试卷切分助手的 Android 外壳。
 *
 * 全部业务逻辑在 assets/www 里的网页中运行（pdf.js + pdf-lib），原生侧只补三件
 * WebView 做不到、但手机上必须有的事：选文件、把结果写进「下载」、唤起系统分享。
 */
class MainActivity : ComponentActivity() {

    companion object {
        private const val TAG = "PdfSplitter"
        private const val START_URL = "https://appassets.androidplatform.net/assets/www/index.html"
        private val DOWNLOAD_DIR = Environment.DIRECTORY_DOWNLOADS + "/试卷切分"

        /** 会真正渲染 PDF 的阅读器，按优先级排；不含邮箱 / 网盘 / AI 助手那类只收附件的应用 */
        private val VIEWER_PREFS = listOf(
            "cn.wps.moffice_eng.xiaomi.lite", "cn.wps.moffice_eng", "cn.wps.moffice", "cn.wps.moffice_pro",
            "com.duokan.reader", "com.ucpro", "com.xodo.pdf.reader", "com.adobe.reader",
        )
    }

    private lateinit var webView: WebView
    private var pendingFiles: ValueCallback<Array<Uri>>? = null
    private var lastSavedUri: Uri? = null
    private var lastSavedName: String = ""

    private val pickPdf = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val callback = pendingFiles
        pendingFiles = null
        if (callback == null) return@registerForActivityResult
        if (uri == null) {
            callback.onReceiveValue(null)
            return@registerForActivityResult
        }
        val dir = File(cacheDir, "pick").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val copied = File(dir, displayNameOf(uri))
        val ok = runCatching {
            contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(copied).use { input.copyTo(it) }
            } ?: error("no stream")
        }.isSuccess
        callback.onReceiveValue(if (ok) arrayOf(Uri.fromFile(copied)) else null)
    }

    /** 保留用户看到的文件名，否则切分结果会丢掉原始卷名 */
    private fun displayNameOf(uri: Uri): String {
        val name = runCatching {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        }.getOrNull()
        return sanitize(name ?: uri.lastPathSegment ?: "paper.pdf")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        if (isDebuggable()) WebView.setWebContentsDebuggingEnabled(true)

        webView.setBackgroundColor(0xFFEDF1F6.toInt())
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // 只加载随包的本地资源，不打开任何远程页面
            allowFileAccess = true
            allowContentAccess = true
            cacheMode = android.webkit.WebSettings.LOAD_CACHE_ELSE_NETWORK
        }

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                pendingFiles?.let { it.onReceiveValue(null) }
                pendingFiles = callback
                return runCatching { pickPdf.launch(arrayOf("application/pdf")) }.isSuccess
                    .also { if (!it) pendingFiles = null }
            }

            override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult?): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setTitle(R.string.app_name)
                    .setMessage(message.orEmpty())
                    .setPositiveButton(android.R.string.ok) { d, _ -> d.dismiss() }
                    .setOnDismissListener { result?.cancel() }
                    .show()
                return true
            }

            override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult?): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setMessage(message.orEmpty())
                    .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm() }
                    .setNegativeButton(android.R.string.cancel) { _, _ -> result?.cancel() }
                    .setOnCancelListener { result?.cancel() }
                    .show()
                return true
            }
        }

        webView.addJavascriptInterface(Shell(), "PdfShell")
        onBackPressedDispatcher.addCallback(this) {
            if (webView.canGoBack()) webView.goBack() else finish()
        }
        webView.loadUrl(START_URL)
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    private fun isDebuggable(): Boolean =
        (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0

    /**
     * 供页面调用的桥：window.PdfShell。
     * 大文件分块 base64 传输，避免一次性把几十 MB 塞进单次桥调用。
     */
    inner class Shell {
        private var target: File? = null
        private var displayName: String = "split.pdf"

        @JavascriptInterface
        fun begin(rawName: String?) {
            displayName = sanitize(rawName)
            val dir = File(cacheDir, "out").apply { mkdirs() }
            dir.listFiles()?.forEach { it.delete() }
            target = File(dir, displayName).also { runCatching { it.delete() && it.createNewFile() } }
        }

        @JavascriptInterface
        fun chunk(part: String?) {
            if (part.isNullOrEmpty()) return
            val file = target ?: return
            val bytes = AndroidBase64.decode(part, AndroidBase64.DEFAULT)
            FileOutputStream(file, true).use { it.write(bytes) }
        }

        /** 写入「下载/试卷切分」，并把真实路径回传给页面显示 */
        @JavascriptInterface
        fun save() {
            val file = target
            if (file == null || !file.exists() || file.length() == 0L) {
                runOnUiThread { toast("还没有可保存的结果，请先完成切分") }
                return
            }
            val saved = runCatching { exportToDownloads(file) }
                .onFailure { Log.e(TAG, "export failed", it) }
                .getOrNull()
            runOnUiThread {
                if (saved == null) {
                    toast("写入「下载」失败")
                    return@runOnUiThread
                }
                lastSavedUri = saved
                val shown = "$DOWNLOAD_DIR/$lastSavedName"
                toast("已保存到 $shown")
                webView.evaluateJavascript(
                    "window.__onPdfSaved&&window.__onPdfSaved(${JSONObject.quote(shown)})", null
                )
            }
        }

        /** 只分享、不写下载目录 —— 避免分享时误报「已保存」 */
        @JavascriptInterface
        fun share() {
            val file = target
            if (file == null || !file.exists() || file.length() == 0L) {
                runOnUiThread { toast("还没有可分享的结果，请先完成切分") }
                return
            }
            runOnUiThread { shareFile(file) }
        }

        /**
         * 查看刚保存的 PDF。系统里注册了 PDF 接收器的应用很多（邮箱、AI 助手、网盘都会把
         * 文件当附件上传），所以优先定向到真正的阅读器，都没有才退回系统选择器。
         */
        @JavascriptInterface
        fun open() {
            val uri = lastSavedUri ?: run {
                runOnUiThread { toast("请先点「保存到本地」") }
                return
            }
            runOnUiThread {
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/pdf")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                val installed = packageManager.queryIntentActivities(intent, 0)
                    .map { it.activityInfo.packageName }.toSet()
                val viewer = VIEWER_PREFS.firstOrNull { it in installed }
                val launch = if (viewer != null) {
                    intent.setPackage(viewer)
                    packageManager.resolveActivity(intent, 0)?.let {
                        intent.component = ComponentName(it.activityInfo.packageName, it.activityInfo.name)
                    }
                    intent
                } else {
                    Intent.createChooser(intent, "选择阅读器打开")
                }
                runCatching { startActivity(launch) }
                    .onFailure {
                        Log.w(TAG, "open failed", it)
                        toast("没有能打开 PDF 的应用，可改用系统分享")
                    }
            }
        }

        @JavascriptInterface
        fun log(msg: String?) {
            if (!msg.isNullOrEmpty()) Log.d(TAG, msg)
        }
    }

    private fun exportToDownloads(src: File): Uri? {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, src.name)
            put(MediaStore.Downloads.MIME_TYPE, "application/pdf")
            put(MediaStore.Downloads.RELATIVE_PATH, DOWNLOAD_DIR)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
        contentResolver.openOutputStream(uri)?.use { out ->
            src.inputStream().use { it.copyTo(out) }
        } ?: return null
        val done = ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }
        contentResolver.update(uri, done, null, null)
        // MediaStore 重名时会自动加 " (1)"，回读真实文件名再展示
        lastSavedName = displayNameOf(uri)
        return uri
    }

    private fun shareFile(file: File) {
        runCatching {
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "application/pdf"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(Intent.createChooser(intent, "分享切分后的试卷"))
        }.onFailure { Log.w(TAG, "share failed", it); toast("未找到可接收 PDF 的应用") }
    }

    private fun sanitize(raw: String?): String {
        var name = raw.orEmpty().trim().ifEmpty { "split.pdf" }
        name = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(120)
        if (!name.endsWith(".pdf", true)) name += ".pdf"
        return name
    }

    private fun fmtSize(b: Long): String = when {
        b < 1024 -> "$b B"
        b < 1048576 -> "%.1f KB".format(b / 1024.0)
        else -> "%.2f MB".format(b / 1048576.0)
    }

    private fun toast(msg: String) {
        android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_SHORT).show()
    }
}
