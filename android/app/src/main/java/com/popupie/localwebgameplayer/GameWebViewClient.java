package com.popupie.localwebgameplayer;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class GameWebViewClient extends BridgeWebViewClient {
    private static final String GAME_ASSET_PREFIX = "/__game__/";
    private static final String GAME_SAVE_PREFIX = "/__save__/";

    public GameWebViewClient(Bridge bridge) { super(bridge); }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        String encodedPath = request.getUrl().getEncodedPath();
        if (encodedPath != null && encodedPath.startsWith(GAME_SAVE_PREFIX)) {
            try {
                String[] parts = encodedPath.substring(GAME_SAVE_PREFIX.length()).split("/", -1);
                if (parts.length != 3) return errorResponse(400, "Bad Request", "Invalid game save URL");
                String gameId = Uri.decode(parts[0]);
                StringBuilder relativePath = new StringBuilder();
                for (int index = 1; index < parts.length; index++) {
                    String part = Uri.decode(parts[index]);
                    if (part.isEmpty() || ".".equals(part) || "..".equals(part)
                            || part.indexOf('/') >= 0 || part.indexOf('\\') >= 0) {
                        return errorResponse(400, "Bad Request", "Invalid game save path");
                    }
                    if (relativePath.length() > 0) relativePath.append('/');
                    relativePath.append(part);
                }
                Uri saveUri = AndroidFolderPickerPlugin.findRegisteredGameSaveUri(
                    gameId, relativePath.toString(), view.getContext().getContentResolver());
                if (saveUri == null) return errorResponse(404, "Not Found", "External save does not exist");
                InputStream input = view.getContext().getContentResolver().openInputStream(saveUri);
                if (input == null) return errorResponse(404, "Not Found", "External save is unavailable");
                Map<String, String> headers = new HashMap<>();
                headers.put("Access-Control-Allow-Origin", "*");
                headers.put("Cache-Control", "no-store");
                headers.put("X-Content-Type-Options", "nosniff");
                return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers, input);
            } catch (Exception error) {
                // Only a successful lookup with no matching document is a definite 404.
                // Provider/permission failures must remain distinguishable from user deletion.
                return errorResponse(500, "Internal Server Error", "Could not open external save");
            }
        }
        WebResourceResponse gameAssetResponse = interceptAndroidGameAsset(view.getContext(), request);
        if (gameAssetResponse != null) {
            return addIsolationHeaders(request, gameAssetResponse);
        }
        return addIsolationHeaders(request, super.shouldInterceptRequest(view, request));
    }

    // AETHERPLAY_ANDROID_SAF_STREAM_V1: shared by WebViewClient and ServiceWorkerClient.
    // The InputStream is passed directly to WebView; file bytes never enter a Base64 bridge.
    static WebResourceResponse interceptAndroidGameAsset(Context context, WebResourceRequest request) {
        if (request == null || request.getUrl() == null) return null;
        String encodedPath = request.getUrl().getEncodedPath();
        if (encodedPath == null || !encodedPath.startsWith(GAME_ASSET_PREFIX)) return null;

        try {
            String method = request.getMethod();
            if (!"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
                return errorResponse(405, "Method Not Allowed", "Unsupported game asset method");
            }
            String[] parts = encodedPath.substring(GAME_ASSET_PREFIX.length()).split("/", -1);
            if (parts.length < 2) return errorResponse(400, "Bad Request", "Invalid game asset URL");
            String gameId = Uri.decode(parts[0]);
            StringBuilder relativePath = new StringBuilder();
            for (int index = 1; index < parts.length; index++) {
                String part = Uri.decode(parts[index]);
                if (part.isEmpty()) continue;
                if (".".equals(part) || "..".equals(part)
                        || part.indexOf('/') >= 0 || part.indexOf('\\') >= 0) {
                    return errorResponse(400, "Bad Request", "Invalid game asset path");
                }
                if (relativePath.length() > 0) relativePath.append('/');
                relativePath.append(part);
            }
            AndroidFolderPickerPlugin.RegisteredGameAsset asset =
                AndroidFolderPickerPlugin.findRegisteredGameAsset(gameId, relativePath.toString());
            if (asset == null) return errorResponse(404, "Not Found", "Game asset not registered");

            String mime = mimeForRegisteredAsset(relativePath.toString(), asset.mime);
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-store");
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Accept-Ranges", "none");
            if (asset.size > 0) headers.put("Content-Length", Long.toString(asset.size));
            if ("HEAD".equalsIgnoreCase(method)) {
                return new WebResourceResponse(mime, null, 200, "OK", headers,
                    new ByteArrayInputStream(new byte[0]));
            }

            InputStream input = context.getContentResolver().openInputStream(Uri.parse(asset.uri));
            if (input == null) return errorResponse(404, "Not Found", "Game asset is unavailable");
            android.util.Log.i("AetherPlaySAF", "stream game=" + gameId + " path="
                + relativePath + " size=" + asset.size);
            return new WebResourceResponse(mime, null, 200, "OK", headers, input);
        } catch (Exception error) {
            android.util.Log.e("AetherPlaySAF", "Could not stream Android game asset", error);
            return errorResponse(500, "Internal Server Error", "Could not open game asset");
        }
    }

    // AETHERPLAY_COI_RESPONSE_HEADERS_V2
    // Top-level document establishes COOP/COEP.
    // Game iframe receives COEP; COOP belongs to the top-level document.
    static WebResourceResponse addIsolationHeaders(
        WebResourceRequest request,
        WebResourceResponse response
    ) {
        if (request == null || response == null || request.getUrl() == null) {
            return response;
        }

        Uri uri = request.getUrl();
        String path = uri.getEncodedPath();

        if (!"https".equalsIgnoreCase(uri.getScheme())
                || !"localhost".equalsIgnoreCase(uri.getHost())
                || path == null) {
            return response;
        }

        boolean topDocument =
            request.isForMainFrame()
            && "GET".equalsIgnoreCase(request.getMethod())
            && (path.isEmpty() || "/".equals(path)
                || "/index.html".equals(path));

        boolean gameDocument = path.startsWith("/play/");
        boolean gameAsset = path.startsWith(GAME_ASSET_PREFIX);

        if (!topDocument && !gameDocument && !gameAsset) {
            return response;
        }

        Map<String, String> headers = new HashMap<>();
        Map<String, String> source = response.getResponseHeaders();

        if (source != null) {
            headers.putAll(source);
        }

        if (topDocument) {
            headers.put("Cross-Origin-Opener-Policy", "same-origin");
            headers.put("Cross-Origin-Embedder-Policy", "require-corp");
            headers.put("Permissions-Policy",
                "cross-origin-isolated=(self)");
        } else if (gameDocument) {
            headers.put("Cross-Origin-Embedder-Policy", "require-corp");
        }

        headers.put("Cross-Origin-Resource-Policy", "same-origin");

        if (topDocument) {
            android.util.Log.i("AetherPlayCOI",
                "top-level COOP/COEP injected: " + path);
        }

        return new WebResourceResponse(
            response.getMimeType(),
            response.getEncoding(),
            response.getStatusCode(),
            response.getReasonPhrase(),
            headers,
            response.getData()
        );
    }

    private static String mimeForRegisteredAsset(String path, String declaredMime) {
        String declared = declaredMime == null ? "" : declaredMime.trim();
        if (!declared.isEmpty() && !declared.matches("(?i)(application|binary)/octet-stream")) {
            return declared;
        }
        String lower = path.toLowerCase(java.util.Locale.ROOT);
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".wasm")) return "application/wasm";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".xml") || lower.endsWith(".txt")) return "text/plain";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".ogg")) return "audio/ogg";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".wav")) return "audio/wav";
        return "application/octet-stream";
    }

    private static WebResourceResponse errorResponse(int status, String reason, String message) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse(
            "text/plain", "UTF-8", status, reason, headers,
            new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8))
        );
    }
}
