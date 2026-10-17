package com.popupie.localwebgameplayer;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AndroidOrientation")
public class AndroidOrientationPlugin extends Plugin {
    @PluginMethod
    public void setOrientation(PluginCall call) {
        String value = call.getString("orientation", "landscape");
        final int requestedOrientation;
        final String normalizedOrientation;
        if ("portrait".equalsIgnoreCase(value)) {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
            normalizedOrientation = "portrait";
        } else if ("landscape".equalsIgnoreCase(value)) {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE;
            normalizedOrientation = "landscape";
        } else if ("system".equalsIgnoreCase(value)) {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
            normalizedOrientation = "system";
        } else {
            call.reject("Orientation must be 'system', 'portrait' or 'landscape'");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Android activity is not available");
            return;
        }
        activity.runOnUiThread(() -> {
            activity.setRequestedOrientation(requestedOrientation);
            JSObject result = new JSObject();
            result.put("orientation", normalizedOrientation);
            call.resolve(result);
        });
    }
}
