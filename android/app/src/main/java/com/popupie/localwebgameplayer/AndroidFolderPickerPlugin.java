package com.popupie.localwebgameplayer;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.io.OutputStream;
import java.util.Arrays;

@CapacitorPlugin(name = "AndroidFolderPicker")
public class AndroidFolderPickerPlugin extends Plugin {
    // REGISTERED_GAME_ASSETS_PATCH: one active game's metadata; no asset bytes are cached here.
    static final class RegisteredGameAsset {
        final String uri;
        final String mime;
        RegisteredGameAsset(String uri, String mime) {
            this.uri = uri;
            this.mime = mime;
        }
    }
    private static final class GameAssetRegistry {
        final String gameId;
        final Map<String, RegisteredGameAsset> assets;
        GameAssetRegistry(String gameId, Map<String, RegisteredGameAsset> assets) {
            this.gameId = gameId;
            this.assets = assets;
        }
    }
    private static volatile GameAssetRegistry activeGameAssetRegistry =
        new GameAssetRegistry("", Collections.emptyMap());

    static RegisteredGameAsset findRegisteredGameAsset(String gameId, String path) {
        GameAssetRegistry registry = activeGameAssetRegistry;
        if (gameId == null || !gameId.equals(registry.gameId)) return null;
        String normalized = normalizeGameAssetPath(path);
        return normalized == null ? null : registry.assets.get(normalized);
    }

    private static String normalizeGameAssetPath(String path) {
        if (path == null) return null;
        String value = path.replace('\\', '/');
        if (value.startsWith("/")) return null;
        StringBuilder normalized = new StringBuilder();
        for (String part : value.split("/")) {
            if (part.isEmpty() || ".".equals(part)) continue;
            if ("..".equals(part)) return null;
            if (normalized.length() > 0) normalized.append('/');
            normalized.append(part);
        }
        return normalized.length() == 0 ? null : normalized.toString();
    }

    private static final int MAX_RUNTIME_LOG_BYTES = 512 * 1024;
    @PluginMethod
    public void pickDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
            | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;

        if (result == null || result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null || result.getData().getData() == null) {
            call.reject("Folder selection cancelled", "CANCELLED");
            return;
        }

        Uri treeUri = result.getData().getData();
        int flags = result.getData().getFlags()
            & (Intent.FLAG_GRANT_READ_URI_PERMISSION
            | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);

        try {
            getContext().getContentResolver()
                .takePersistableUriPermission(treeUri, flags);
        } catch (Exception ignored) {
            // Some document providers do not support persistent access.
        }

        JSObject response = new JSObject();
        response.put("treeUri", treeUri.toString());
        response.put("folderName", getFolderName(treeUri));
        call.resolve(response);
    }

    private String getFolderName(Uri treeUri) {
        try {
            String id = DocumentsContract.getTreeDocumentId(treeUri);
            Uri documentUri =
                DocumentsContract.buildDocumentUriUsingTree(treeUri, id);
            try (Cursor cursor = getContext().getContentResolver().query(
                    documentUri,
                    new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},
                    null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    String name = cursor.getString(0);
                    if (name != null && !name.isEmpty()) return name;
                }
            }
        } catch (Exception ignored) {
        }
        return "Selected folder";
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        String value = call.getString("treeUri");
        if (value == null || value.isEmpty()) {
            call.reject("Missing selected folder URI");
            return;
        }

        try {
            Uri treeUri = Uri.parse(value);
            String rootId = DocumentsContract.getTreeDocumentId(treeUri);
            JSArray files = new JSArray();
            appendFiles(treeUri, rootId, "", files);

            JSObject response = new JSObject();
            response.put("files", files);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Could not scan the selected folder: " + error.getMessage(), error);
        }
    }

    private void appendFiles(
            Uri treeUri, String documentId, String prefix, JSArray files
    ) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        Uri childrenUri =
            DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, documentId);

        String[] columns = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE
        };

        try (Cursor cursor = resolver.query(
                childrenUri, columns, null, null, null)) {
            if (cursor == null) return;

            while (cursor.moveToNext()) {
                String childId = cursor.getString(0);
                String name = cursor.getString(1);
                String mime = cursor.getString(2);
                if (name == null || name.isEmpty()) continue;

                String relativePath = prefix.isEmpty()
                    ? name : prefix + "/" + name;

                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    appendFiles(treeUri, childId, relativePath, files);
                    continue;
                }

                Uri fileUri =
                    DocumentsContract.buildDocumentUriUsingTree(treeUri, childId);

                JSObject item = new JSObject();
                item.put("relativePath", relativePath);
                item.put("uri", fileUri.toString());
                item.put("mimeType", mime == null ? "" : mime);
                item.put("size", cursor.isNull(3) ? 0 : cursor.getLong(3));
                files.put(item);
            }
        }
    }

    @PluginMethod
    public void registerGameAssets(PluginCall call) {
        String gameId = call.getString("gameId");
        JSONArray files = call.getData().optJSONArray("files");
        if (gameId == null || gameId.isEmpty() || files == null) {
            call.reject("Missing game ID or asset list");
            return;
        }
        try {
            Boolean appendValue = call.getBoolean("append");
            GameAssetRegistry current = activeGameAssetRegistry;
            Map<String, RegisteredGameAsset> next = Boolean.TRUE.equals(appendValue)
                    && gameId.equals(current.gameId)
                ? new HashMap<>(current.assets)
                : new HashMap<>();
            for (int i = 0; i < files.length(); i++) {
                JSONObject item = files.optJSONObject(i);
                if (item == null) continue;
                String path = normalizeGameAssetPath(item.optString("path", ""));
                String uriValue = item.optString("uri", "");
                String mime = item.optString("mime", "application/octet-stream");
                if (path == null || uriValue.isEmpty()) continue;
                Uri uri = Uri.parse(uriValue);
                // Only URIs granted by Android's document picker are accepted.
                if (!"content".equals(uri.getScheme())) continue;
                if (mime == null || mime.isEmpty()) mime = "application/octet-stream";
                next.put(path, new RegisteredGameAsset(uriValue, mime));
            }
            if (next.isEmpty()) {
                call.reject("No valid Android game asset URIs were registered");
                return;
            }
            activeGameAssetRegistry = new GameAssetRegistry(
                gameId, Collections.unmodifiableMap(next)
            );
            JSObject response = new JSObject();
            response.put("registeredCount", next.size());
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Could not register Android game assets: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String value = call.getString("uri");
        if (value == null || value.isEmpty()) {
            call.reject("Missing file URI");
            return;
        }

        try (InputStream input = getContext().getContentResolver()
                .openInputStream(Uri.parse(value));
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IllegalStateException("Cannot open file");

            byte[] buffer = new byte[65536];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }

            JSObject response = new JSObject();
            response.put(
                "data",
                Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
            );
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Could not read selected file: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public synchronized void appendRuntimeLog(PluginCall call) {
        String treeValue = call.getString("treeUri");
        String content = call.getString("content");
        if (treeValue == null || treeValue.isEmpty()) {
            call.reject("Missing selected game folder URI");
            return;
        }
        if (content == null) content = "";

        try {
            Uri treeUri = Uri.parse(treeValue);
            String rootId = DocumentsContract.getTreeDocumentId(treeUri);
            Uri parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, rootId);
            ContentResolver resolver = getContext().getContentResolver();
            java.util.List<RuntimeLogDocument> oldLogs = listRuntimeLogDocuments(treeUri, rootId);

            // Use an explicit .txt extension because SAF's text/plain provider adds it itself.
            Uri logUri = findChildDocument(treeUri, rootId, "runtime.log.txt");
            if (logUri == null) logUri = findChildDocument(treeUri, rootId, "runtime.log");
            if (logUri == null) {
                logUri = getOrCreateLogUri(getContext(), resolver, parentUri, "runtime.log.txt");
            }
            if (logUri == null) throw new IllegalStateException("Could not create runtime.log.txt in the selected game folder");

            byte[] incoming = content.getBytes(StandardCharsets.UTF_8);
            if (incoming.length > MAX_RUNTIME_LOG_BYTES) {
                incoming = Arrays.copyOfRange(incoming, incoming.length - MAX_RUNTIME_LOG_BYTES, incoming.length);
            }

            boolean consolidate = oldLogs.size() > 1;
            if (!consolidate && oldLogs.size() == 1 && !oldLogs.get(0).uri.toString().equals(logUri.toString())) {
                consolidate = true;
            }
            if (consolidate) {
                // Merge existing duplicate fragments once, oldest first, retaining the latest 512 KiB.
                java.util.Collections.sort(oldLogs, java.util.Comparator.comparingLong(item -> item.lastModified));
                ByteArrayOutputStream combinedOut = new ByteArrayOutputStream();
                for (RuntimeLogDocument item : oldLogs) {
                    byte[] oldBytes = readDocumentBytes(item.uri);
                    combinedOut.write(oldBytes);
                    if (oldBytes.length > 0 && oldBytes[oldBytes.length - 1] != '\n') combinedOut.write('\n');
                }
                combinedOut.write(incoming);
                byte[] combined = tailBytes(combinedOut.toByteArray(), MAX_RUNTIME_LOG_BYTES);
                writeDocumentBytes(logUri, combined, "wt");
            } else {
                long existingSize = getDocumentSize(logUri);
                if (existingSize + incoming.length > MAX_RUNTIME_LOG_BYTES) {
                    int keep = Math.max(0, MAX_RUNTIME_LOG_BYTES - incoming.length);
                    byte[] oldTail = keep > 0 ? readDocumentTail(logUri, keep) : new byte[0];
                    byte[] compacted = new byte[oldTail.length + incoming.length];
                    System.arraycopy(oldTail, 0, compacted, 0, oldTail.length);
                    System.arraycopy(incoming, 0, compacted, oldTail.length, incoming.length);
                    writeDocumentBytes(logUri, compacted, "wt");
                } else {
                    writeDocumentBytes(logUri, incoming, "wa");
                }
            }

            // Remove .1 and numbered .txt copies after consolidation, leaving one log document.
            deleteDuplicateRuntimeLogs(treeUri, rootId, resolver, logUri);
            JSObject response = new JSObject();
            response.put("uri", logUri.toString());
            response.put("trimmed", consolidate || getDocumentSize(logUri) >= MAX_RUNTIME_LOG_BYTES);
            response.put("bytesWritten", incoming.length);
            response.put("singleLogFile", true);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Could not write runtime.log to the selected game folder: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void exportTextFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("text/plain");
        String filename = call.getString("filename");
        if (filename == null || filename.trim().isEmpty()) {
            filename = "LocalWebGamePlayer-diagnostics.txt";
        }
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "diagnosticTextFileCreated");
    }

    @ActivityCallback
    private void diagnosticTextFileCreated(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result == null || result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null || result.getData().getData() == null) {
            call.reject("TXT save cancelled", "CANCELLED");
            return;
        }
        Uri uri = result.getData().getData();
        String content = call.getString("content");
        if (content == null) content = "";
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wa")) {
            if (output == null) throw new IllegalStateException("Could not open destination file");
            output.write(content.getBytes(StandardCharsets.UTF_8));
            output.flush();
            JSObject response = new JSObject();
            response.put("uri", uri.toString());
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Could not save diagnostics TXT: " + error.getMessage(), error);
        }
    }

    // AETHER_WOLF_BINARY_EXPORT
    @PluginMethod
    public void exportBinaryFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/octet-stream");
        String filename = call.getString("filename");
        if (filename == null || filename.trim().isEmpty()) filename = "game-save.sav";
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "runtimeBinaryFileCreated");
    }

    @ActivityCallback
    private void runtimeBinaryFileCreated(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result == null || result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null || result.getData().getData() == null) {
            call.reject("Save export cancelled", "CANCELLED");
            return;
        }

        String encoded = call.getString("data");
        if (encoded == null || encoded.isEmpty()) {
            call.reject("Missing binary file data");
            return;
        }
        // Bound the native bridge payload to 16 MiB of decoded file data.
        if (encoded.length() > 22_369_624) {
            call.reject("File exceeds the 16 MiB export limit");
            return;
        }

        Uri uri = result.getData().getData();
        try {
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            if (bytes.length > 16 * 1024 * 1024) {
                call.reject("File exceeds the 16 MiB export limit");
                return;
            }
            try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (output == null) throw new IllegalStateException("Could not open destination file");
                output.write(bytes);
                output.flush();
            }
            JSObject response = new JSObject();
            response.put("uri", uri.toString());
            response.put("bytesWritten", bytes.length);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Could not export save file: " + error.getMessage(), error);
        }
    }

    // AETHER_WOLF_BINARY_IMPORT
    @PluginMethod
    public void importBinaryFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "runtimeBinaryFileSelected");
    }

    @ActivityCallback
    private void runtimeBinaryFileSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result == null || result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null || result.getData().getData() == null) {
            call.reject("Save import cancelled", "CANCELLED");
            return;
        }

        Uri uri = result.getData().getData();
        String filename = "imported-save.sav";
        try (Cursor cursor = getContext().getContentResolver().query(
                uri, new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.trim().isEmpty()) filename = name;
            }
        } catch (Exception ignored) {
            // Use the fallback filename if a document provider hides metadata.
        }

        try (InputStream input = getContext().getContentResolver().openInputStream(uri);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IllegalStateException("Cannot open selected save file");
            byte[] buffer = new byte[65536];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > 16 * 1024 * 1024) {
                    call.reject("Save file exceeds the 16 MiB import limit");
                    return;
                }
                output.write(buffer, 0, count);
            }
            byte[] bytes = output.toByteArray();
            JSObject response = new JSObject();
            response.put("filename", filename);
            response.put("size", bytes.length);
            response.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Could not read selected save file: " + error.getMessage(), error);
        }
    }

    // RUNTIME_LOG_DEDUP_PATCH
    private static final class RuntimeLogDocument {
        final Uri uri;
        final String name;
        final long lastModified;
        RuntimeLogDocument(Uri uri, String name, long lastModified) {
            this.uri = uri;
            this.name = name;
            this.lastModified = lastModified;
        }
    }

    private boolean isRuntimeLogName(String name) {
        return "runtime.log".equals(name)
            || "runtime.log.txt".equals(name)
            || "runtime.log.1".equals(name)
            || (name != null && name.matches("runtime\\.log \\(\\d+\\)\\.txt"));
    }

    private java.util.List<RuntimeLogDocument> listRuntimeLogDocuments(Uri treeUri, String parentId) throws Exception {
        java.util.List<RuntimeLogDocument> result = new java.util.ArrayList<>();
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId);
        String[] columns = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED
        };
        try (Cursor cursor = getContext().getContentResolver().query(childrenUri, columns, null, null, null)) {
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    String name = cursor.getString(1);
                    if (!isRuntimeLogName(name)) continue;
                    long modified = cursor.isNull(2) ? 0L : cursor.getLong(2);
                    Uri uri = DocumentsContract.buildDocumentUriUsingTree(treeUri, cursor.getString(0));
                    result.add(new RuntimeLogDocument(uri, name, modified));
                }
            }
        }
        return result;
    }

    private byte[] readDocumentBytes(Uri uri) throws Exception {
        try (InputStream input = getContext().getContentResolver().openInputStream(uri);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IllegalStateException("Cannot read existing runtime log fragment");
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toByteArray();
        }
    }

    private byte[] tailBytes(byte[] input, int maxBytes) {
        if (input.length <= maxBytes) return input;
        return Arrays.copyOfRange(input, input.length - maxBytes, input.length);
    }

    private void deleteDuplicateRuntimeLogs(Uri treeUri, String parentId, ContentResolver resolver, Uri keepUri) {
        try {
            for (RuntimeLogDocument item : listRuntimeLogDocuments(treeUri, parentId)) {
                if (!item.uri.toString().equals(keepUri.toString())) {
                    try { DocumentsContract.deleteDocument(resolver, item.uri); } catch (Exception ignored) {}
                }
            }
        } catch (Exception ignored) {
            // Best-effort cleanup must not interrupt game startup.
        }
    }

    private Uri findChildDocument(Uri treeUri, String parentId, String wantedName) throws Exception {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId);
        String[] columns = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME
        };
        try (Cursor cursor = getContext().getContentResolver().query(
                childrenUri, columns, null, null, null)) {
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    String name = cursor.getString(1);
                    if (wantedName.equals(name)) {
                        return DocumentsContract.buildDocumentUriUsingTree(treeUri, cursor.getString(0));
                    }
                }
            }
        }
        return null;
    }

    private long getDocumentSize(Uri uri) throws Exception {
        try (Cursor cursor = getContext().getContentResolver().query(
                uri, new String[]{DocumentsContract.Document.COLUMN_SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) {
                return Math.max(0L, cursor.getLong(0));
            }
        } catch (Exception ignored) {
            // Some document providers do not expose a size column; count the stream below.
        }
        try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IllegalStateException("Cannot read existing runtime.log size");
            byte[] buffer = new byte[8192];
            long total = 0;
            int count;
            while ((count = input.read(buffer)) != -1) total += count;
            return total;
        }
    }

    private byte[] readDocumentTail(Uri uri, int maxBytes) throws Exception {
        byte[] ring = new byte[maxBytes];
        long total = 0;
        try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IllegalStateException("Cannot read existing runtime.log for rotation");
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                int offset = 0;
                while (offset < count) {
                    int slot = (int) ((total + offset) % maxBytes);
                    int part = Math.min(count - offset, maxBytes - slot);
                    System.arraycopy(buffer, offset, ring, slot, part);
                    offset += part;
                }
                total += count;
            }
        }
        int length = (int) Math.min(total, (long) maxBytes);
        byte[] result = new byte[length];
        long start = total > maxBytes ? total % maxBytes : 0;
        for (int i = 0; i < length; i++) result[i] = ring[(int) ((start + i) % maxBytes)];
        return result;
    }

    private void writeDocumentBytes(Uri uri, byte[] bytes, String mode) throws Exception {
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, mode)) {
            if (output == null) throw new IllegalStateException("Could not open runtime log document for writing");
            output.write(bytes);
            output.flush();
        }
    }


    private Uri getOrCreateLogUri(android.content.Context context, android.content.ContentResolver resolver, Uri parentUri, String fileName) {
        Uri targetUri = null;
        try (android.database.Cursor cursor = resolver.query(parentUri, null, null, null, null)) {
            while (cursor != null && cursor.moveToNext()) {
                String displayName = cursor.getString(cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME));
                if (fileName.equals(displayName)) {
                    String documentId = cursor.getString(cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID));
                    targetUri = DocumentsContract.buildDocumentUriUsingTree(parentUri, documentId);
                    break;
                }
            }
        } catch (Exception e) {
            // ignore
        }
        if (targetUri == null) {
            try {
            targetUri = DocumentsContract.createDocument(resolver, parentUri, "text/plain", fileName);
        } catch (java.io.FileNotFoundException e) {
            throw new RuntimeException("Failed to create log file: " + fileName, e);
        }
        }
        
        // 每次获取时，追加 session 头部
        if (targetUri != null) {
            try (java.io.OutputStream os = resolver.openOutputStream(targetUri, "wa")) {
                String header = "\n---- session " + new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new java.util.Date()) + " ----\n";
                os.write(header.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            } catch (Exception e) {
                // ignore
            }
        }
        return targetUri;
    }

}
