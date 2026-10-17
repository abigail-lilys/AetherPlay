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
import java.nio.charset.StandardCharsets;
import java.io.OutputStream;
import java.util.Arrays;

@CapacitorPlugin(name = "AndroidFolderPicker")
public class AndroidFolderPickerPlugin extends Plugin {
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
            Uri logUri = findChildDocument(treeUri, rootId, "runtime.log");
            if (logUri == null) {
                logUri = DocumentsContract.createDocument(resolver, parentUri, "text/plain", "runtime.log");
            }
            if (logUri == null) throw new IllegalStateException("Could not create runtime.log in the selected game folder");

            byte[] incoming = content.getBytes(StandardCharsets.UTF_8);
            if (incoming.length > MAX_RUNTIME_LOG_BYTES) {
                incoming = Arrays.copyOfRange(incoming, incoming.length - MAX_RUNTIME_LOG_BYTES, incoming.length);
            }

            long existingSize = getDocumentSize(logUri);
            boolean trimmed = existingSize + incoming.length > MAX_RUNTIME_LOG_BYTES;
            if (trimmed) {
                int bytesToKeep = Math.max(0, MAX_RUNTIME_LOG_BYTES - incoming.length);
                byte[] oldTail = bytesToKeep > 0 ? readDocumentTail(logUri, bytesToKeep) : new byte[0];
                byte[] compacted = new byte[oldTail.length + incoming.length];
                System.arraycopy(oldTail, 0, compacted, 0, oldTail.length);
                System.arraycopy(incoming, 0, compacted, oldTail.length, incoming.length);
                writeDocumentBytes(logUri, compacted, "wt");
            } else {
                writeDocumentBytes(logUri, incoming, "wa");
            }

            // Remove the legacy rotating backup so the selected game folder keeps one log file only.
            try {
                Uri oldBackup = findChildDocument(treeUri, rootId, "runtime.log.1");
                if (oldBackup != null) DocumentsContract.deleteDocument(resolver, oldBackup);
            } catch (Exception ignored) {
                // Existing backup cleanup must not interrupt game startup.
            }
            JSObject response = new JSObject();
            response.put("uri", logUri.toString());
            response.put("trimmed", trimmed);
            response.put("bytesWritten", incoming.length);
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
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
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

}
