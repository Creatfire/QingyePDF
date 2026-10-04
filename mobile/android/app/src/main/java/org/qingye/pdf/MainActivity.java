package org.qingye.pdf;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Needed for exporting long Markdown documents as one image; must precede any WebView.
        WebView.enableSlowWholeDocumentDraw();
        registerPlugin(QingyeNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
