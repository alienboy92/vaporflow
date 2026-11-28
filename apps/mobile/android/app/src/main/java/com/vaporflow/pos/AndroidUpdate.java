package com.vaporflow.pos;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.InputStream;
import java.io.FileOutputStream;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import javax.net.ssl.HttpsURLConnection;

@CapacitorPlugin(name = "AndroidUpdate")
public class AndroidUpdate extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private File ready;

    @PluginMethod
    public void download(PluginCall call) {
        worker.execute(() -> {
            File temp = null;
            HttpsURLConnection connection = null;
            try {
                ready = null;
                String source = call.getString("url", "");
                String hash = call.getString("sha256", "");
                if (!source.matches("https://github[.]com/alienboy92/vaporflow/releases/download/v[0-9.]+/[A-Za-z0-9._-]+[.]apk") || !hash.matches("[a-fA-F0-9]{64}"))
                    throw new Exception("Invalid release asset");
                connection = (HttpsURLConnection) new URL(source).openConnection();
                connection.setConnectTimeout(20000);
                connection.setReadTimeout(60000);
                if (connection.getResponseCode() != 200) throw new Exception("Download failed");
                temp = File.createTempFile("android-update-", ".tmp", getContext().getCacheDir());
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(temp)) {
                    byte[] buffer = new byte[65536];
                    int size;
                    while ((size = in.read(buffer)) != -1) {
                        digest.update(buffer, 0, size);
                        out.write(buffer, 0, size);
                    }
                }
                StringBuilder actual = new StringBuilder();
                for (byte b : digest.digest()) actual.append(String.format("%02x", b));
                if (!actual.toString().equalsIgnoreCase(hash)) throw new Exception("Checksum mismatch");
                File apk = new File(getContext().getCacheDir(), "pending-update.apk");
                if (!temp.renameTo(apk)) throw new Exception("Cannot save update");
                PackageManager pm = getContext().getPackageManager();
                PackageInfo next = pm.getPackageArchiveInfo(apk.getPath(), PackageManager.GET_SIGNATURES);
                PackageInfo current = pm.getPackageInfo(getContext().getPackageName(), PackageManager.GET_SIGNATURES);
                if (next == null || !current.packageName.equals(next.packageName) || next.versionCode <= current.versionCode || !Arrays.equals(current.signatures, next.signatures))
                    throw new Exception("APK does not match this installation");
                ready = apk;
                call.resolve();
            } catch (Exception ex) { call.reject("Unable to verify or download the Android update.", ex); }
            finally {
                if (temp != null && temp.exists()) temp.delete();
                if (connection != null) connection.disconnect();
            }
        });
    }

    @PluginMethod
    public void install(PluginCall call) {
        worker.execute(() -> {
            if (ready == null || !ready.isFile()) { call.reject("Download the update first."); return; }
            try {
                if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                    getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName())));
                    call.reject("Allow installs from Bali Hub POS, then tap Install update again.");
                    return;
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", ready);
                getActivity().startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
                call.resolve();
            } catch (Exception ex) { call.reject("Android could not open the installer.", ex); }
        });
    }
}
