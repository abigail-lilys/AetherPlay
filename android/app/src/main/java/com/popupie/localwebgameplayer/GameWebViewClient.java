package com.popupie.localwebgameplayer;

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

    public GameWebViewClient(Bridge bridge) { super(bridge); }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        String encodedPath = request.getUrl().getEncodedPath();
        if (encodedPath != null && encodedPath.startsWith(GAME_ASSET_PREFIX)) {
            try {
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

                InputStream input = view.getContext().getContentResolver()
                    .openInputStream(Uri.parse(asset.uri));
                if (input == null) return errorResponse(404, "Not Found", "Game asset is unavailable");
                Map<String, String> headers = new HashMap<>();
                headers.put("Access-Control-Allow-Origin", "*");
                headers.put("Cache-Control", "no-store");
                headers.put("X-Content-Type-Options", "nosniff");
                String mime = asset.mime == null || asset.mime.isEmpty()
                    ? "application/octet-stream" : asset.mime;
                return new WebResourceResponse(mime, null, 200, "OK", headers, input);
            } catch (Exception error) {
                return errorResponse(404, "Not Found", "Could not open game asset");
            }
        }
        return super.shouldInterceptRequest(view, request);
    }

    private WebResourceResponse errorResponse(int status, String reason, String message) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse(
            "text/plain", "UTF-8", status, reason, headers,
            new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8))
        );
    }
}
