package com.popupie.localwebgameplayer;

import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.File;
import java.io.FileInputStream;
import java.net.URLDecoder;
import java.util.HashMap;
import java.util.Map;

public class GameWebViewClient extends BridgeWebViewClient {
    // 默认强制指向你的游戏目录
    public static volatile String gameRoot = "/storage/emulated/0/ApkWolfRpg/mi-test";

    public GameWebViewClient(Bridge bridge) { super(bridge); }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        String path = request.getUrl().getPath();
        if (gameRoot != null && path != null && path.startsWith("/__game__/")) {
            try {
                String rel = URLDecoder.decode(path.substring("/__game__/".length()), "UTF-8");
                File f = new File(gameRoot, rel);
                if (!f.getCanonicalPath().startsWith(new File(gameRoot).getCanonicalPath())) return null; // 防止 ../
                if (!f.isFile()) return null;
                String ext = MimeTypeMap.getFileExtensionFromUrl(f.getName());
                String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
                Map<String, String> h = new HashMap<>();
                h.put("Access-Control-Allow-Origin", "*");
                return new WebResourceResponse(mime != null ? mime : "application/octet-stream", null,
                        200, "OK", h, new FileInputStream(f));
            } catch (Exception e) { return null; }
        }
        return super.shouldInterceptRequest(view, request);
    }
}
