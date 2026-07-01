package com.ntag424scanner.app;

import android.app.Activity;
import android.content.Intent;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.IsoDep;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;

import java.io.IOException;
import java.util.Arrays;

/**
 * Capacitor Plugin: Ntag424
 *
 * Provides direct ISO-DEP (ISO 14443-4) APDU communication with NXP NTAG 424 DNA TT chips.
 *
 * This plugin uses Android's NfcAdapter and IsoDep API to:
 *   1. Wait for an NFC tag tap (via foreground dispatch)
 *   2. Connect to the tag via IsoDep
 *   3. Select the NTAG 424 application (AID: D2 76 00 00 85 01 01)
 *   4. Read the UID from the tag activation response
 *   5. Issue GetTTStatus (CMD 0xF7) to read tamper wire status
 *   6. Return all data to the React app via Capacitor plugin call
 *
 * Tamper Status values:
 *   CC = 43 43 hex → Tamper wire intact (not tampered)
 *   OC = 4F 43 hex → Was tampered in past, wire appears OK now
 *   OO = 4F 4F hex → Currently tampered (wire broken)
 *   II = 49 49 hex → Tamper feature not enabled/initialized
 *
 * References:
 *   - NXP NT4H2421Tx Datasheet (Section 11.9.1 GetTTStatus)
 *   - NXP AN12196 Application Note
 */
@CapacitorPlugin(name = "Ntag424")
public class Ntag424Plugin extends Plugin {

    private static final String TAG = "Ntag424Plugin";

    // NTAG 424 Application ID
    private static final byte[] NTAG424_AID = {
        (byte) 0xD2, (byte) 0x76, (byte) 0x00, (byte) 0x00,
        (byte) 0x85, (byte) 0x01, (byte) 0x01
    };

    // ISO 7816-4: SELECT APPLICATION by AID (DF Name)
    // CLA=00, INS=A4, P1=04 (by name), P2=0C (first/only), Lc=07, AID(7 bytes)
    private static final byte[] CMD_SELECT_APPLICATION = {
        (byte) 0x00, (byte) 0xA4, (byte) 0x04, (byte) 0x0C,
        (byte) 0x07,
        (byte) 0xD2, (byte) 0x76, (byte) 0x00, (byte) 0x00, (byte) 0x85, (byte) 0x01, (byte) 0x01
    };

    // GetTTStatus: ISO 7816-4 wrapped native command (0xF7)
    // CLA=90, INS=F7, P1=00, P2=00, Lc=00, Le=00
    private static final byte[] CMD_GET_TT_STATUS = {
        (byte) 0x90, (byte) 0xF7, (byte) 0x00, (byte) 0x00,
        (byte) 0x00, (byte) 0x00
    };

    // GetVersion Part 1: used to verify chip type and get UID
    // CLA=90, INS=60, P1=00, P2=00, Lc=00, Le=00
    private static final byte[] CMD_GET_VERSION_PART1 = {
        (byte) 0x90, (byte) 0x60, (byte) 0x00, (byte) 0x00,
        (byte) 0x00, (byte) 0x00
    };

    // GetVersion Part 2 (continue after AF response)
    private static final byte[] CMD_GET_VERSION_PART2 = {
        (byte) 0x90, (byte) 0xAF, (byte) 0x00, (byte) 0x00,
        (byte) 0x00, (byte) 0x00
    };

    // GetVersion Part 3 (continue)
    private static final byte[] CMD_GET_VERSION_PART3 = {
        (byte) 0x90, (byte) 0xAF, (byte) 0x00, (byte) 0x00,
        (byte) 0x00, (byte) 0x00
    };

    // Response status bytes
    private static final byte SW1_SUCCESS_NATIVE = (byte) 0x91;
    private static final byte SW2_SUCCESS = (byte) 0x00;
    private static final byte SW2_MORE_DATA = (byte) 0xAF;
    private static final byte SW1_ISO_SUCCESS = (byte) 0x90;

    private PluginCall pendingScanCall = null;
    private NfcAdapter nfcAdapter = null;

    @Override
    public void load() {
        nfcAdapter = NfcAdapter.getDefaultAdapter(getActivity());
    }

    /**
     * Main plugin method: scanNtag424()
     *
     * Called from JavaScript to start scanning for an NTAG 424 TT tag.
     * Enables foreground NFC dispatch and waits for a tag tap.
     *
     * Returns via PluginCall resolve/reject:
     * {
     *   uid: "04:A1:B2:C3:D4:E5:F6",
     *   tamperStatus: "CC",
     *   tamperStatusRaw: "CC",
     *   nfcCounter: 42,         // optional
     *   method: "iso_dep"
     * }
     */
    @PluginMethod
    public void scanNtag424(PluginCall call) {
        if (nfcAdapter == null) {
            call.reject("NFC_NOT_AVAILABLE", "NFC is not available on this device");
            return;
        }

        if (!nfcAdapter.isEnabled()) {
            call.reject("NFC_DISABLED", "NFC is disabled. Please enable NFC in device settings.");
            return;
        }

        // Store the call for when the NFC intent arrives
        pendingScanCall = call;
        call.setKeepAlive(true);

        // Enable foreground dispatch to receive NFC intents
        enableForegroundDispatch();

        Log.d(TAG, "Waiting for NFC tag...");
    }

    /**
     * Stop scanning and release NFC foreground dispatch.
     */
    @PluginMethod
    public void stopScan(PluginCall call) {
        disableForegroundDispatch();
        if (pendingScanCall != null) {
            pendingScanCall.resolve(new JSObject().put("cancelled", true));
            pendingScanCall = null;
        }
        call.resolve();
    }

    /**
     * Enable NFC foreground dispatch to intercept tag discoveries.
     */
    private void enableForegroundDispatch() {
        Activity activity = getActivity();
        if (activity == null || nfcAdapter == null) return;

        Intent intent = new Intent(activity, activity.getClass())
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        android.app.PendingIntent pendingIntent = android.app.PendingIntent.getActivity(
            activity, 0, intent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT |
            android.app.PendingIntent.FLAG_MUTABLE
        );

        // Filter for ISO-DEP (ISO 14443-4) tags — which is what NTAG 424 uses
        android.nfc.tech.NfcA[] techLists = null;
        String[][] techFilters = new String[][] {
            new String[] { IsoDep.class.getName() }
        };

        activity.runOnUiThread(() -> {
            try {
                nfcAdapter.enableForegroundDispatch(activity, pendingIntent, null, techFilters);
            } catch (Exception e) {
                Log.e(TAG, "Error enabling foreground dispatch", e);
            }
        });
    }

    /**
     * Disable NFC foreground dispatch.
     */
    private void disableForegroundDispatch() {
        Activity activity = getActivity();
        if (activity == null || nfcAdapter == null) return;
        activity.runOnUiThread(() -> {
            try {
                nfcAdapter.disableForegroundDispatch(activity);
            } catch (Exception e) {
                Log.e(TAG, "Error disabling foreground dispatch", e);
            }
        });
    }

    /**
     * Called by the Activity when a new NFC intent arrives.
     * This is triggered from MainActivity.onNewIntent().
     */
    public void handleNfcIntent(Intent intent) {
        if (pendingScanCall == null) return;
        if (!NfcAdapter.ACTION_TECH_DISCOVERED.equals(intent.getAction()) &&
            !NfcAdapter.ACTION_TAG_DISCOVERED.equals(intent.getAction()) &&
            !NfcAdapter.ACTION_NDEF_DISCOVERED.equals(intent.getAction())) {
            return;
        }

        Tag tag = intent.getParcelableExtra(NfcAdapter.EXTRA_TAG);
        if (tag == null) {
            resolveError("TAG_LOST", "No NFC tag found in intent");
            return;
        }

        // Process tag in background thread to avoid ANR
        PluginCall call = pendingScanCall;
        pendingScanCall = null;
        disableForegroundDispatch();

        new Thread(() -> processTag(tag, call)).start();
    }

    /**
     * Core NFC processing logic.
     * Runs on a background thread.
     *
     * Steps:
     *   1. Connect via IsoDep
     *   2. Get UID from tag (from activation, not APDU)
     *   3. Select NTAG 424 application
     *   4. Issue GetTTStatus (0xF7)
     *   5. Parse and return results
     */
    private void processTag(Tag tag, PluginCall call) {
        IsoDep isoDep = IsoDep.get(tag);
        if (isoDep == null) {
            resolveErrorOnCall(call, "NO_NTAG424",
                "Tag does not support ISO-DEP. This may not be an NTAG 424 chip.");
            return;
        }

        try {
            isoDep.connect();
            isoDep.setTimeout(5000); // 5 second timeout

            // Step 1: Read UID from the tag (hardware level, before APDU)
            byte[] uidBytes = tag.getId();
            String uid = formatUID(uidBytes);
            Log.d(TAG, "Tag UID: " + uid);

            // Step 2: Select the NTAG 424 application
            byte[] selectResponse = isoDep.transceive(CMD_SELECT_APPLICATION);
            Log.d(TAG, "SELECT response: " + bytesToHex(selectResponse));

            if (!isISOSuccess(selectResponse)) {
                // Try if it's already selected or a different response
                Log.w(TAG, "SELECT APP failed, trying anyway: " + bytesToHex(selectResponse));
            }

            // Step 3: GetTTStatus command (0xF7)
            // NOTE: On chips with factory default keys (all zeros), no authentication needed.
            // If a TTStatusKey has been set, this will return an error code, and the user
            // needs to authenticate first. We handle this gracefully.
            byte[] ttStatusResponse = isoDep.transceive(CMD_GET_TT_STATUS);
            Log.d(TAG, "GetTTStatus response: " + bytesToHex(ttStatusResponse));

            JSObject result = new JSObject();
            result.put("uid", uid);
            result.put("method", "iso_dep");

            if (isNativeSuccess(ttStatusResponse)) {
                // Parse tamper status bytes
                // Response format: [byte0][byte1][SW1=91][SW2=00]
                // byte0, byte1 are ASCII chars of status (CC, OC, OO, II)
                if (ttStatusResponse.length >= 4) {
                    char statusByte1 = (char) ttStatusResponse[0];
                    char statusByte2 = (char) ttStatusResponse[1];
                    String tamperRaw = "" + statusByte1 + statusByte2;
                    result.put("tamperStatusRaw", tamperRaw);
                    result.put("tamperStatus", mapTamperStatus(tamperRaw));
                    Log.d(TAG, "Tamper status: " + tamperRaw);
                } else {
                    result.put("tamperStatusRaw", "??");
                    result.put("tamperStatus", "UNKNOWN");
                }
            } else if (ttStatusResponse.length >= 2) {
                byte sw1 = ttStatusResponse[ttStatusResponse.length - 2];
                byte sw2 = ttStatusResponse[ttStatusResponse.length - 1];

                if (sw1 == (byte) 0x91 && sw2 == (byte) 0xAD) {
                    // Authentication required for GetTTStatus
                    result.put("tamperStatus", "AUTH_REQUIRED");
                    result.put("tamperStatusRaw", "AUTH");
                    Log.w(TAG, "GetTTStatus requires authentication (TTStatusKey is set)");
                } else if (sw1 == (byte) 0x91 && sw2 == (byte) 0x1C) {
                    // Command not available (TT feature not initialized)
                    result.put("tamperStatus", "II");
                    result.put("tamperStatusRaw", "II");
                } else {
                    result.put("tamperStatus", "UNKNOWN");
                    result.put("tamperStatusRaw", String.format("SW: %02X %02X", sw1, sw2));
                }
            } else {
                result.put("tamperStatus", "UNKNOWN");
                result.put("tamperStatusRaw", "ERR");
            }

            // Also try to read NDEF content for SUN URL (optional)
            try {
                // ISO Read Binary: select NDEF file (E1 04) and read
                byte[] selectNdef = { 0x00, (byte) 0xA4, 0x00, 0x0C, 0x02, (byte) 0xE1, 0x04 };
                byte[] selectNdefResp = isoDep.transceive(selectNdef);
                if (isISOSuccess(selectNdefResp)) {
                    // Read first 2 bytes to get NDEF length
                    byte[] readLen = { 0x00, (byte) 0xB0, 0x00, 0x00, 0x02 };
                    byte[] lenResp = isoDep.transceive(readLen);
                    if (isISOSuccess(lenResp) && lenResp.length >= 4) {
                        int ndefLen = ((lenResp[0] & 0xFF) << 8) | (lenResp[1] & 0xFF);
                        if (ndefLen > 0 && ndefLen <= 254) {
                            // Read NDEF content
                            byte[] readNdef = { 0x00, (byte) 0xB0, 0x00, 0x02, (byte) (ndefLen & 0xFF) };
                            byte[] ndefResp = isoDep.transceive(readNdef);
                            if (isISOSuccess(ndefResp)) {
                                String ndefUrl = extractUrlFromNDEF(
                                    Arrays.copyOf(ndefResp, ndefResp.length - 2)
                                );
                                if (ndefUrl != null) {
                                    result.put("ndefUrl", ndefUrl);
                                    Log.d(TAG, "NDEF URL: " + ndefUrl);
                                }
                            }
                        }
                    }
                }
            } catch (Exception e) {
                // NDEF reading is optional, ignore errors
                Log.d(TAG, "NDEF read skipped: " + e.getMessage());
            }

            call.resolve(result);

        } catch (IOException e) {
            Log.e(TAG, "IO error during NFC communication", e);
            resolveErrorOnCall(call, "TAG_LOST",
                "Tag wurde während der Kommunikation entfernt: " + e.getMessage());
        } finally {
            try {
                isoDep.close();
            } catch (IOException ignored) {}
        }
    }

    /**
     * Map raw 2-char tamper status to display string.
     */
    private String mapTamperStatus(String raw) {
        switch (raw) {
            case "CC": return "CC";
            case "OC": return "OC";
            case "OO": return "OO";
            case "II": return "II";
            default:   return "UNKNOWN";
        }
    }

    /**
     * Check if response has native success status (91 00).
     */
    private boolean isNativeSuccess(byte[] response) {
        int len = response.length;
        return len >= 2 &&
               response[len - 2] == SW1_SUCCESS_NATIVE &&
               response[len - 1] == SW2_SUCCESS;
    }

    /**
     * Check if response has ISO success status (90 00).
     */
    private boolean isISOSuccess(byte[] response) {
        int len = response.length;
        return len >= 2 &&
               response[len - 2] == SW1_ISO_SUCCESS &&
               response[len - 1] == SW2_SUCCESS;
    }

    /**
     * Format UID bytes as colon-separated hex string.
     * e.g. [0x04, 0xA1, 0xB2] → "04:A1:B2"
     */
    private String formatUID(byte[] uid) {
        if (uid == null || uid.length == 0) return "UNKNOWN";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < uid.length; i++) {
            if (i > 0) sb.append(':');
            sb.append(String.format("%02X", uid[i]));
        }
        return sb.toString();
    }

    /**
     * Convert byte array to hex string for logging.
     */
    private String bytesToHex(byte[] bytes) {
        if (bytes == null) return "null";
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02X ", b));
        }
        return sb.toString().trim();
    }

    /**
     * Try to extract a URL string from raw NDEF bytes.
     * Handles Well-Known Type "U" (URL) records.
     */
    private String extractUrlFromNDEF(byte[] ndefData) {
        if (ndefData == null || ndefData.length < 3) return null;
        try {
            // Simple NDEF parser for URL records (TNF=0x01, Type="U")
            int offset = 0;
            while (offset < ndefData.length) {
                if (offset + 3 > ndefData.length) break;
                int tnfFlags = ndefData[offset] & 0xFF;
                int tnf = tnfFlags & 0x07;
                boolean shortRecord = (tnfFlags & 0x10) != 0;
                int typeLen = ndefData[offset + 1] & 0xFF;
                int payloadLen;
                if (shortRecord) {
                    payloadLen = ndefData[offset + 2] & 0xFF;
                    offset += 3;
                } else {
                    if (offset + 6 > ndefData.length) break;
                    payloadLen = ((ndefData[offset + 2] & 0xFF) << 24) |
                                 ((ndefData[offset + 3] & 0xFF) << 16) |
                                 ((ndefData[offset + 4] & 0xFF) << 8) |
                                  (ndefData[offset + 5] & 0xFF);
                    offset += 6;
                }

                // Read type
                if (offset + typeLen > ndefData.length) break;
                byte[] typeBytes = Arrays.copyOfRange(ndefData, offset, offset + typeLen);
                offset += typeLen;

                // Read payload
                if (offset + payloadLen > ndefData.length) break;
                byte[] payload = Arrays.copyOfRange(ndefData, offset, offset + payloadLen);
                offset += payloadLen;

                // Check if it's a URL record (TNF=0x01, Type="U")
                if (tnf == 0x01 && typeLen == 1 && typeBytes[0] == 'U' && payload.length > 0) {
                    // First byte is URL scheme prefix
                    String prefix = getUrlPrefix(payload[0]);
                    String rest = new String(Arrays.copyOfRange(payload, 1, payload.length),
                                            java.nio.charset.StandardCharsets.UTF_8);
                    return prefix + rest;
                }
            }
        } catch (Exception e) {
            Log.d(TAG, "NDEF URL parse error: " + e.getMessage());
        }
        return null;
    }

    /**
     * Get URL scheme prefix from NFC Forum URI identifier code.
     */
    private String getUrlPrefix(byte code) {
        switch (code) {
            case 0x01: return "http://www.";
            case 0x02: return "https://www.";
            case 0x03: return "http://";
            case 0x04: return "https://";
            case 0x05: return "tel:";
            case 0x06: return "mailto:";
            default:   return "";
        }
    }

    private void resolveError(String code, String message) {
        if (pendingScanCall != null) {
            resolveErrorOnCall(pendingScanCall, code, message);
            pendingScanCall = null;
        }
    }

    private void resolveErrorOnCall(PluginCall call, String code, String message) {
        JSObject error = new JSObject();
        error.put("errorCode", code);
        error.put("errorMessage", message);
        call.resolve(error);
    }
}
