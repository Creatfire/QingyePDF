package org.qingye.pdf;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.print.QingyePdfPrinter;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Everything the Android build of Qingye PDF needs from the device: real files on shared storage,
 * documents handed over by other apps, AI network requests, HTML to PDF / PNG rendering, a
 * Keystore-protected data key and window chrome. The JavaScript side lives in mobile/src.
 */
@CapacitorPlugin(
    name = "QingyeNative",
    permissions = { @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE }) }
)
public class QingyeNativePlugin extends Plugin {

    private static final String IMPORT_FOLDER = "导入";
    private static final int MAX_BITMAP_HEIGHT = 16000;

    private final ExecutorService network = Executors.newCachedThreadPool();
    // Incoming documents are copied one after another; pendingOpens() queues behind them.
    private final ExecutorService intents = Executors.newSingleThreadExecutor();
    private final Map<String, HttpURLConnection> requests = new ConcurrentHashMap<>();
    private final List<String> pendingOpens = new ArrayList<>();
    private final Handler main = new Handler(Looper.getMainLooper());

    // ——— lifecycle ———

    @Override
    public void load() {
        getActivity()
            .getOnBackPressedDispatcher()
            .addCallback(
                getActivity(),
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        notifyListeners("back", new JSObject());
                    }
                }
            );
        collect(getActivity().getIntent(), false);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        collect(intent, true);
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        notifyListeners("pause", new JSObject());
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        notifyListeners("resume", new JSObject());
    }

    @Override
    protected void handleOnDestroy() {
        network.shutdownNow();
        intents.shutdownNow();
        super.handleOnDestroy();
    }

    // ——— locations and storage access ———

    private boolean storageGranted() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) return Environment.isExternalStorageManager();
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private File sharedRoot() {
        return Environment.getExternalStorageDirectory();
    }

    /** The app's own document folder: on shared storage once access is granted, private before. */
    private File inbox() {
        File folder;
        if (storageGranted()) folder = new File(new File(sharedRoot(), "Documents"), "QingyePDF");
        else {
            File external = getContext().getExternalFilesDir(null);
            folder = new File(external != null ? external : getContext().getFilesDir(), "QingyePDF");
        }
        if (!folder.isDirectory()) folder.mkdirs();
        return folder;
    }

    private JSObject locations() {
        JSObject out = new JSObject();
        boolean granted = storageGranted();
        File userData = new File(getContext().getFilesDir(), "qingye");
        File temp = new File(getContext().getCacheDir(), "qingye-tmp");
        userData.mkdirs();
        temp.mkdirs();
        File inbox = inbox();
        out.put("userData", userData.getAbsolutePath());
        out.put("temp", temp.getAbsolutePath());
        out.put("storage", granted ? sharedRoot().getAbsolutePath() : inbox.getAbsolutePath());
        out.put("documents", granted ? new File(sharedRoot(), "Documents").getAbsolutePath() : inbox.getAbsolutePath());
        out.put("inbox", inbox.getAbsolutePath());
        out.put("granted", granted);
        out.put("sdk", Build.VERSION.SDK_INT);
        return out;
    }

    @PluginMethod
    public void paths(PluginCall call) {
        call.resolve(locations());
    }

    @PluginMethod
    public void storageState(PluginCall call) {
        call.resolve(locations());
    }

    @PluginMethod
    public void requestStorage(PluginCall call) {
        if (storageGranted()) {
            call.resolve(locations());
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
            if (intent.resolveActivity(getContext().getPackageManager()) == null) intent = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
            try {
                startActivityForResult(call, intent, "storageSettingsResult");
            } catch (Exception error) {
                call.reject("无法打开系统的文件访问权限设置。", "EPERM");
            }
        } else {
            requestPermissionForAlias("storage", call, "storagePermissionResult");
        }
    }

    @ActivityCallback
    private void storageSettingsResult(PluginCall call, ActivityResult result) {
        if (call != null) call.resolve(locations());
    }

    @PermissionCallback
    private void storagePermissionResult(PluginCall call) {
        if (call != null) call.resolve(locations());
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject(String.valueOf(error.getMessage()));
        }
    }

    // ——— files ———

    private static String code(File file, IOException error) {
        String message = String.valueOf(error.getMessage());
        if (!file.exists() && (file.getParentFile() == null || !file.getParentFile().exists())) return "ENOENT";
        if (message.contains("EACCES") || message.contains("Permission denied") || message.contains("EPERM")) return "EACCES";
        if (message.contains("ENOSPC")) return "ENOSPC";
        if (message.contains("ENOENT")) return "ENOENT";
        return "EIO";
    }

    private static void fail(PluginCall call, String code, String detail) {
        call.reject(code + ": " + detail, code);
    }

    private File target(PluginCall call, String key) {
        String path = call.getString(key);
        if (path == null || path.isEmpty() || !path.startsWith("/")) {
            fail(call, "EINVAL", "invalid path");
            return null;
        }
        return new File(path);
    }

    private static JSObject describe(File file) {
        JSObject out = new JSObject();
        out.put("type", file.isDirectory() ? "dir" : "file");
        out.put("size", file.isDirectory() ? 0 : file.length());
        out.put("mtime", file.lastModified());
        return out;
    }

    @PluginMethod
    public void stat(PluginCall call) {
        File file = target(call, "path");
        if (file == null) return;
        if (!file.exists()) {
            fail(call, "ENOENT", "no such file or directory");
            return;
        }
        call.resolve(describe(file));
    }

    @PluginMethod
    public void readdir(PluginCall call) {
        File dir = target(call, "path");
        if (dir == null) return;
        if (!dir.exists()) {
            fail(call, "ENOENT", "no such file or directory");
            return;
        }
        if (!dir.isDirectory()) {
            fail(call, "ENOTDIR", "not a directory");
            return;
        }
        File[] children = dir.listFiles();
        if (children == null) {
            fail(call, "EACCES", "permission denied");
            return;
        }
        JSArray entries = new JSArray();
        for (File child : children) {
            JSObject entry = describe(child);
            entry.put("name", child.getName());
            entries.put(entry);
        }
        JSObject out = new JSObject();
        out.put("entries", entries);
        call.resolve(out);
    }

    @PluginMethod
    public void mkdir(PluginCall call) {
        File dir = target(call, "path");
        if (dir == null) return;
        boolean recursive = Boolean.TRUE.equals(call.getBoolean("recursive", false));
        if (dir.isDirectory()) {
            if (recursive) call.resolve();
            else fail(call, "EEXIST", "file already exists");
            return;
        }
        if (dir.exists()) {
            fail(call, "EEXIST", "file already exists");
            return;
        }
        if (!recursive && (dir.getParentFile() == null || !dir.getParentFile().isDirectory())) {
            fail(call, "ENOENT", "no such file or directory");
            return;
        }
        if (recursive ? dir.mkdirs() || dir.isDirectory() : dir.mkdir()) call.resolve();
        else fail(call, "EACCES", "cannot create directory");
    }

    private static boolean deleteTree(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) if (!deleteTree(child)) return false;
        }
        return file.delete();
    }

    @PluginMethod
    public void rm(PluginCall call) {
        File file = target(call, "path");
        if (file == null) return;
        if (!file.exists()) {
            fail(call, "ENOENT", "no such file or directory");
            return;
        }
        boolean recursive = Boolean.TRUE.equals(call.getBoolean("recursive", false));
        if (file.isDirectory() && !recursive) {
            String[] names = file.list();
            if (names != null && names.length > 0) {
                fail(call, "ENOTEMPTY", "directory not empty");
                return;
            }
        }
        if (recursive ? deleteTree(file) : file.delete()) call.resolve();
        else fail(call, "EACCES", "cannot delete");
    }

    private static void copyStream(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[1 << 16];
        int read;
        while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
    }

    private static void copyFile(File from, File to) throws IOException {
        try (InputStream in = new FileInputStream(from); FileOutputStream out = new FileOutputStream(to)) {
            copyStream(in, out);
            out.getFD().sync();
        }
    }

    @PluginMethod
    public void rename(PluginCall call) {
        File from = target(call, "from"), to = target(call, "to");
        if (from == null || to == null) return;
        if (!from.exists()) {
            fail(call, "ENOENT", "no such file or directory");
            return;
        }
        if (to.getParentFile() == null || !to.getParentFile().isDirectory()) {
            fail(call, "ENOENT", "no such file or directory");
            return;
        }
        if (from.renameTo(to)) {
            call.resolve();
            return;
        }
        // Different volumes (private storage ↔ shared storage): copy, then remove the source.
        if (from.isFile()) {
            try {
                copyFile(from, to);
                if (!from.delete()) from.deleteOnExit();
                call.resolve();
                return;
            } catch (IOException error) {
                fail(call, code(to, error), String.valueOf(error.getMessage()));
                return;
            }
        }
        fail(call, "EACCES", "cannot rename");
    }

    @PluginMethod
    public void copy(PluginCall call) {
        File from = target(call, "from"), to = target(call, "to");
        if (from == null || to == null) return;
        if (!from.isFile()) {
            fail(call, "ENOENT", "no such file or directory");
            return;
        }
        if (Boolean.TRUE.equals(call.getBoolean("exclusive", false)) && to.exists()) {
            fail(call, "EEXIST", "file already exists");
            return;
        }
        try {
            copyFile(from, to);
            call.resolve();
        } catch (IOException error) {
            fail(call, code(to, error), String.valueOf(error.getMessage()));
        }
    }

    @PluginMethod
    public void read(PluginCall call) {
        File file = target(call, "path");
        if (file == null) return;
        if (!file.isFile()) {
            fail(call, file.exists() ? "EISDIR" : "ENOENT", "no such file");
            return;
        }
        long offset = Math.max(0, call.getLong("offset", 0L));
        int length = Math.max(0, Math.min(8 << 20, call.getInt("length", 8 << 20)));
        try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
            long remaining = Math.max(0, input.length() - offset);
            byte[] buffer = new byte[(int) Math.min(length, remaining)];
            input.seek(offset);
            input.readFully(buffer);
            JSObject out = new JSObject();
            out.put("data", Base64.encodeToString(buffer, Base64.NO_WRAP));
            call.resolve(out);
        } catch (IOException error) {
            fail(call, code(file, error), String.valueOf(error.getMessage()));
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        File file = target(call, "path");
        if (file == null) return;
        if (file.isDirectory()) {
            fail(call, "EISDIR", "is a directory");
            return;
        }
        String data = call.getString("data", "");
        boolean append = Boolean.TRUE.equals(call.getBoolean("append", false));
        try (FileOutputStream out = new FileOutputStream(file, append)) {
            out.write(Base64.decode(data, Base64.DEFAULT));
            out.getFD().sync();
            call.resolve();
        } catch (IOException error) {
            fail(call, code(file, error), String.valueOf(error.getMessage()));
        } catch (IllegalArgumentException error) {
            fail(call, "EINVAL", "invalid data");
        }
    }

    // ——— documents from other apps ———

    private String displayName(Uri uri) {
        String name = null;
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) name = cursor.getString(0);
        } catch (Exception ignored) {}
        if (name == null || name.isEmpty()) name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "document";
        name = name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_");
        if (!name.contains(".")) {
            String type = getContext().getContentResolver().getType(uri);
            if ("application/pdf".equals(type)) name += ".pdf";
            else if (type != null && type.contains("markdown")) name += ".md";
        }
        return name;
    }

    /** The real file behind a content URI, when it is on shared storage and readable. */
    private File directFile(Uri uri) {
        try {
            if ("file".equals(uri.getScheme())) {
                File file = new File(String.valueOf(uri.getPath()));
                return file.canRead() ? file : null;
            }
            if (!storageGranted() || !ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) return null;
            if (DocumentsContract.isDocumentUri(getContext(), uri) && "com.android.externalstorage.documents".equals(uri.getAuthority())) {
                String[] parts = DocumentsContract.getDocumentId(uri).split(":", 2);
                if (parts.length == 2 && "primary".equalsIgnoreCase(parts[0])) {
                    File file = new File(sharedRoot(), parts[1]);
                    if (file.isFile() && file.canRead()) return file;
                }
                return null;
            }
            try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { MediaStore.MediaColumns.DATA }, null, null, null)) {
                if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) {
                    File file = new File(cursor.getString(0));
                    if (file.isFile() && file.canRead() && file.canWrite()) return file;
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    private static File unique(File folder, String name) {
        File candidate = new File(folder, name);
        int dot = name.lastIndexOf('.');
        String stem = dot > 0 ? name.substring(0, dot) : name, extension = dot > 0 ? name.substring(dot) : "";
        for (int n = 2; candidate.exists(); n++) candidate = new File(folder, stem + " (" + n + ")" + extension);
        return candidate;
    }

    /** Opens in place when possible; otherwise keeps a copy in the app's import folder. */
    private String materialize(Uri uri) throws IOException {
        File direct = directFile(uri);
        if (direct != null) return direct.getAbsolutePath();
        File folder = new File(inbox(), IMPORT_FOLDER);
        if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("cannot create import folder");
        File copy = unique(folder, displayName(uri));
        try (InputStream in = getContext().getContentResolver().openInputStream(uri); FileOutputStream out = new FileOutputStream(copy)) {
            if (in == null) throw new IOException("cannot open document");
            copyStream(in, out);
        }
        return copy.getAbsolutePath();
    }

    private List<Uri> urisOf(Intent intent) {
        List<Uri> uris = new ArrayList<>();
        if (intent == null) return uris;
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action) || Intent.ACTION_EDIT.equals(action)) {
            if (intent.getData() != null) uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ClipData clip = intent.getClipData();
            if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) if (clip.getItemAt(i).getUri() != null) uris.add(clip.getItemAt(i).getUri());
            if (uris.isEmpty()) {
                Object stream = intent.getExtras() == null ? null : intent.getExtras().get(Intent.EXTRA_STREAM);
                if (stream instanceof Uri) uris.add((Uri) stream);
                else if (stream instanceof List) for (Object item : (List<?>) stream) if (item instanceof Uri) uris.add((Uri) item);
            }
        }
        return uris;
    }

    private void collect(Intent intent, boolean notify) {
        final List<Uri> uris = urisOf(intent);
        if (uris.isEmpty()) return;
        // The intent must not be handled again after a configuration change or process restore.
        if (intent != null) intent.setAction(Intent.ACTION_MAIN);
        intents.execute(() -> {
            JSArray paths = new JSArray();
            for (Uri uri : uris) {
                try {
                    String path = materialize(uri);
                    paths.put(path);
                    synchronized (pendingOpens) {
                        if (!notify) pendingOpens.add(path);
                    }
                } catch (Exception ignored) {}
            }
            if (notify && paths.length() > 0) {
                JSObject event = new JSObject();
                event.put("paths", paths);
                notifyListeners("open", event, true);
            }
        });
    }

    @PluginMethod
    public void pendingOpens(final PluginCall call) {
        intents.execute(() -> {
            JSArray paths = new JSArray();
            synchronized (pendingOpens) {
                for (String path : pendingOpens) paths.put(path);
                pendingOpens.clear();
            }
            JSObject out = new JSObject();
            out.put("paths", paths);
            call.resolve(out);
        });
    }

    @PluginMethod
    public void pickAndImport(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, Boolean.TRUE.equals(call.getBoolean("multiple", false)));
        try {
            startActivityForResult(call, intent, "pickResult");
        } catch (Exception error) {
            call.reject("系统文件选择器不可用。");
        }
    }

    @ActivityCallback
    private void pickResult(final PluginCall call, ActivityResult result) {
        if (call == null) return;
        final Intent data = result.getData();
        final JSObject out = new JSObject();
        final JSArray paths = new JSArray();
        out.put("paths", paths);
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            call.resolve(out);
            return;
        }
        final List<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
        else if (data.getData() != null) uris.add(data.getData());
        network.execute(() -> {
            try {
                for (Uri uri : uris) paths.put(materialize(uri));
                call.resolve(out);
            } catch (Exception error) {
                call.reject(String.valueOf(error.getMessage()));
            }
        });
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        File file = target(call, "path");
        if (file == null) return;
        if (!file.isFile()) {
            fail(call, "ENOENT", "no such file");
            return;
        }
        try {
            // Files outside the app's own folders are shared through a copy in the cache.
            File shared = new File(new File(getContext().getCacheDir(), "share"), file.getName());
            shared.getParentFile().mkdirs();
            copyFile(file, shared);
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", shared);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(call.getString("mime", "application/octet-stream"));
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.setClipData(ClipData.newRawUri(file.getName(), uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(send, file.getName()));
            call.resolve();
        } catch (Exception error) {
            call.reject(String.valueOf(error.getMessage()));
        }
    }

    // ——— window ———

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("mailto:")) {
            call.reject("不支持的链接。");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("没有可以打开此链接的应用。");
        }
    }

    @PluginMethod
    public void exitApp(PluginCall call) {
        call.resolve();
        main.post(() -> getActivity().finishAndRemoveTask());
    }

    @PluginMethod
    public void moveToBackground(PluginCall call) {
        main.post(() -> getActivity().moveTaskToBack(true));
        call.resolve();
    }

    @PluginMethod
    public void setImmersive(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        main.post(() -> {
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getActivity().getWindow(), getActivity().getWindow().getDecorView());
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            if (enabled) controller.hide(WindowInsetsCompat.Type.systemBars());
            else controller.show(WindowInsetsCompat.Type.systemBars());
            call.resolve();
        });
    }

    /** Colours the area behind the system bars like the app's title bar and picks readable icons. */
    @PluginMethod
    public void setBars(PluginCall call) {
        final boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        final int color = Color.parseColor(dark ? "#0e1512" : "#eef3f0");
        main.post(() -> {
            View decor = getActivity().getWindow().getDecorView();
            getActivity().getWindow().setBackgroundDrawable(new ColorDrawable(color));
            decor.setBackgroundColor(color);
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getActivity().getWindow(), decor);
            controller.setAppearanceLightStatusBars(!dark);
            controller.setAppearanceLightNavigationBars(!dark);
            call.resolve();
        });
    }

    @PluginMethod
    public void keepScreenOn(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        main.post(() -> {
            if (enabled) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    // ——— secrets ———

    private static final String KEY_ALIAS = "qingye.data";

    private SecretKey keystoreKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return (SecretKey) store.getKey(KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(
            new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }

    /** A random data key, stored encrypted by a key that never leaves the Android Keystore. */
    @PluginMethod
    public void dataKey(PluginCall call) {
        try {
            SharedPreferences preferences = getContext().getSharedPreferences("qingye.secure", Context.MODE_PRIVATE);
            String stored = preferences.getString("dataKey", null);
            byte[] key;
            if (stored != null) {
                byte[] blob = Base64.decode(stored, Base64.NO_WRAP);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, keystoreKey(), new GCMParameterSpec(128, blob, 0, 12));
                key = cipher.doFinal(blob, 12, blob.length - 12);
            } else {
                key = new byte[32];
                new SecureRandom().nextBytes(key);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, keystoreKey());
                byte[] iv = cipher.getIV(), sealed = cipher.doFinal(key), blob = new byte[iv.length + sealed.length];
                System.arraycopy(iv, 0, blob, 0, iv.length);
                System.arraycopy(sealed, 0, blob, iv.length, sealed.length);
                preferences.edit().putString("dataKey", Base64.encodeToString(blob, Base64.NO_WRAP)).apply();
            }
            JSObject out = new JSObject();
            out.put("key", Base64.encodeToString(key, Base64.NO_WRAP));
            call.resolve(out);
        } catch (Exception error) {
            call.reject("Keystore: " + error.getMessage());
        }
    }

    // ——— network for AI requests ———

    @PluginMethod
    public void httpStart(final PluginCall call) {
        final String id = call.getString("id", ""), address = call.getString("url", "");
        final String method = call.getString("method", "GET").toUpperCase(Locale.US), body = call.getString("body", "");
        final boolean base64 = Boolean.TRUE.equals(call.getBoolean("bodyIsBase64", false));
        final JSObject headers = call.getObject("headers", new JSObject());
        if (id.isEmpty() || !(address.startsWith("https://") || address.startsWith("http://"))) {
            call.reject("请求地址无效。");
            return;
        }
        network.execute(() -> {
            HttpURLConnection connection = null;
            boolean answered = false;
            try {
                connection = (HttpURLConnection) new URL(address).openConnection();
                requests.put(id, connection);
                connection.setRequestMethod(method);
                connection.setConnectTimeout(30000);
                connection.setReadTimeout(300000);
                connection.setInstanceFollowRedirects(true);
                for (Iterator<String> names = headers.keys(); names.hasNext();) {
                    String name = names.next();
                    connection.setRequestProperty(name, headers.getString(name));
                }
                if (!body.isEmpty() && !"GET".equals(method) && !"HEAD".equals(method)) {
                    byte[] bytes = base64 ? Base64.decode(body, Base64.DEFAULT) : body.getBytes(StandardCharsets.UTF_8);
                    connection.setDoOutput(true);
                    connection.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream out = connection.getOutputStream()) {
                        out.write(bytes);
                    }
                }
                int status = connection.getResponseCode();
                JSObject responseHeaders = new JSObject();
                for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
                    if (entry.getKey() == null || entry.getValue() == null) continue;
                    String name = entry.getKey().toLowerCase(Locale.US);
                    // The body arrives decoded; framing headers would mislead the page's Response.
                    if (name.equals("content-encoding") || name.equals("content-length") || name.equals("transfer-encoding")) continue;
                    responseHeaders.put(name, String.join(", ", entry.getValue()));
                }
                JSObject head = new JSObject();
                head.put("status", status);
                head.put("statusText", connection.getResponseMessage() == null ? "" : connection.getResponseMessage());
                head.put("headers", responseHeaders);
                call.resolve(head);
                answered = true;
                InputStream in = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                if (in != null) {
                    try (InputStream stream = in) {
                        byte[] buffer = new byte[16384];
                        int read;
                        while ((read = stream.read(buffer)) >= 0) {
                            if (read == 0) continue;
                            JSObject chunk = new JSObject();
                            chunk.put("id", id);
                            chunk.put("data", Base64.encodeToString(buffer, 0, read, Base64.NO_WRAP));
                            notifyListeners("http", chunk);
                        }
                    }
                }
                JSObject done = new JSObject();
                done.put("id", id);
                done.put("done", true);
                notifyListeners("http", done);
            } catch (Exception error) {
                String message = error.getClass().getSimpleName() + (error.getMessage() == null ? "" : ": " + error.getMessage());
                if (!answered) call.reject(message);
                else {
                    JSObject failed = new JSObject();
                    failed.put("id", id);
                    failed.put("error", message);
                    notifyListeners("http", failed);
                }
            } finally {
                requests.remove(id);
                if (connection != null) connection.disconnect();
            }
        });
    }

    @PluginMethod
    public void httpCancel(PluginCall call) {
        final HttpURLConnection connection = requests.remove(call.getString("id", ""));
        if (connection != null) network.execute(connection::disconnect);
        call.resolve();
    }

    // ——— HTML → PDF / PNG ———

    private WebView offscreen(boolean scripts) {
        WebView view = new WebView(getContext());
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(scripts);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setBlockNetworkLoads(true);
        settings.setTextZoom(100);
        return view;
    }

    private static int mils(double millimetres) {
        return (int) Math.round(millimetres / 25.4 * 1000);
    }

    @PluginMethod
    public void htmlToPdf(final PluginCall call) {
        final String html = call.getString("html", "");
        final double width = call.getDouble("widthMm", 210.0), height = call.getDouble("heightMm", 297.0), margin = call.getDouble("marginMm", 20.0);
        final File target = new File(new File(getContext().getCacheDir(), "qingye-tmp"), "export-" + System.nanoTime() + ".pdf");
        target.getParentFile().mkdirs();
        main.post(() -> {
            try {
                final WebView view = offscreen(false);
                view.setWebViewClient(
                    new WebViewClient() {
                        private boolean started;

                        @Override
                        public void onPageFinished(final WebView page, String url) {
                            if (started) return;
                            started = true;
                            // Fonts and images settle shortly after the load event.
                            main.postDelayed(
                                () -> {
                                    try {
                                        PrintAttributes attributes = new PrintAttributes.Builder()
                                            .setMediaSize(new PrintAttributes.MediaSize("qingye", "qingye", mils(width), mils(height)))
                                            .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 600, 600))
                                            .setMinMargins(new PrintAttributes.Margins(mils(margin), mils(margin), mils(margin), mils(margin)))
                                            .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                                            .build();
                                        PrintDocumentAdapter adapter = page.createPrintDocumentAdapter("qingye-export");
                                        QingyePdfPrinter.print(adapter, attributes, target, error -> {
                                            main.post(page::destroy);
                                            if (error != null) {
                                                call.reject("无法生成 PDF：" + error);
                                                return;
                                            }
                                            JSObject out = new JSObject();
                                            out.put("path", target.getAbsolutePath());
                                            call.resolve(out);
                                        });
                                    } catch (Throwable error) {
                                        page.destroy();
                                        call.reject("无法生成 PDF：" + error.getMessage());
                                    }
                                },
                                500
                            );
                        }
                    }
                );
                view.loadDataWithBaseURL("https://qingye.invalid/", html, "text/html", "UTF-8", null);
            } catch (Throwable error) {
                call.reject("无法生成 PDF：" + error.getMessage());
            }
        });
    }

    /** Fallback for devices where direct PDF output is unavailable: the system print dialog. */
    @PluginMethod
    public void printHtml(final PluginCall call) {
        final String html = call.getString("html", ""), name = call.getString("name", "Qingye PDF");
        main.post(() -> {
            try {
                final WebView view = offscreen(false);
                view.setWebViewClient(
                    new WebViewClient() {
                        @Override
                        public void onPageFinished(WebView page, String url) {
                            PrintManager manager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                            manager.print(name, page.createPrintDocumentAdapter(name), new PrintAttributes.Builder().build());
                            call.resolve();
                        }
                    }
                );
                view.loadDataWithBaseURL("https://qingye.invalid/", html, "text/html", "UTF-8", null);
            } catch (Throwable error) {
                call.reject(String.valueOf(error.getMessage()));
            }
        });
    }

    @PluginMethod
    public void htmlToPng(final PluginCall call) {
        final String html = call.getString("html", "");
        final int width = Math.max(320, Math.min(2400, call.getInt("width", 900)));
        final boolean scripts = Boolean.TRUE.equals(call.getBoolean("scripts", false));
        final File target = new File(new File(getContext().getCacheDir(), "qingye-tmp"), "export-" + System.nanoTime() + ".png");
        target.getParentFile().mkdirs();
        main.post(() -> {
            try {
                final WebView view = offscreen(scripts);
                view.setInitialScale(100);
                view.getSettings().setUseWideViewPort(true);
                view.getSettings().setLoadWithOverviewMode(false);
                view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY));
                view.layout(0, 0, width, 800);
                view.setWebViewClient(
                    new WebViewClient() {
                        private boolean started;

                        @Override
                        public void onPageFinished(final WebView page, String url) {
                            if (started) return;
                            started = true;
                            main.postDelayed(
                                () -> {
                                    try {
                                        int content = (int) Math.ceil(page.getContentHeight() * page.getScale());
                                        int height = Math.max(200, Math.min(MAX_BITMAP_HEIGHT, content));
                                        page.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
                                        page.layout(0, 0, width, height);
                                        final Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
                                        Canvas canvas = new Canvas(bitmap);
                                        canvas.drawColor(Color.WHITE);
                                        page.draw(canvas);
                                        page.destroy();
                                        network.execute(() -> {
                                            try (FileOutputStream out = new FileOutputStream(target)) {
                                                bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
                                                JSObject result = new JSObject();
                                                result.put("path", target.getAbsolutePath());
                                                call.resolve(result);
                                            } catch (Exception error) {
                                                call.reject("无法生成图片：" + error.getMessage());
                                            } finally {
                                                bitmap.recycle();
                                            }
                                        });
                                    } catch (Throwable error) {
                                        call.reject("无法生成图片：" + error.getMessage());
                                    }
                                },
                                700
                            );
                        }
                    }
                );
                view.loadDataWithBaseURL("https://qingye.invalid/", html, "text/html", "UTF-8", null);
            } catch (Throwable error) {
                call.reject("无法生成图片：" + error.getMessage());
            }
        });
    }
}
