package com.ntag424scanner.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * MainActivity for NTAG 424 TT Scanner App.
 *
 * Registers the Ntag424Plugin and forwards NFC intents to it.
 */
public class MainActivity extends BridgeActivity {

    private Ntag424Plugin ntag424Plugin;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(Ntag424Plugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (ntag424Plugin == null && bridge != null) {
            ntag424Plugin = bridge.getPlugin("Ntag424") != null
                ? (Ntag424Plugin) bridge.getPlugin("Ntag424").getInstance()
                : null;
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (ntag424Plugin != null) {
            ntag424Plugin.handleNfcIntent(intent);
        }
    }
}
