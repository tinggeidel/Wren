import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";

// Full-screen camera that reads one product barcode and hands the digits back.
// Used inside the Food tab's add flow; the parent looks the code up in OFF.
export default function BarcodeScanner({
  onScanned,
  onClose,
}: {
  onScanned: (code: string) => void;
  onClose: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [handled, setHandled] = useState(false);

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permTitle}>Camera access</Text>
        <Text style={styles.permText}>
          Wren needs the camera to scan food barcodes. Nothing is recorded — it just reads the code.
        </Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Allow camera</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelLink} onPress={onClose}>
          <Text style={styles.cancelLinkText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39"],
        }}
        onBarcodeScanned={
          handled
            ? undefined
            : ({ data }) => {
                // Belt guard: `handled` is async to apply, so within a single
                // mount expo-camera can fire several callbacks before the handler
                // is swapped to undefined. Drop repeats synchronously. (The parent
                // CoachScreen also holds a durable ref lock that survives remount.)
                if (handled) return;
                if (!data) return;
                setHandled(true);
                onScanned(data);
              }
        }
      />
      <View style={styles.overlay} pointerEvents="box-none">
        <Text style={styles.hint}>Point at a product barcode</Text>
        <View style={styles.frame} />
        {handled && <ActivityIndicator color="#fff" style={{ marginTop: 20 }} />}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#000" },
  center: {
    flex: 1,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  permTitle: { color: "#fff", fontSize: 20, fontWeight: "700", marginBottom: 10 },
  permText: { color: "#ccc", fontSize: 15, textAlign: "center", lineHeight: 22 },
  permBtn: {
    backgroundColor: "#7c3aed",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
    marginTop: 24,
  },
  permBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cancelLink: { marginTop: 18 },
  cancelLinkText: { color: "#aaa", fontSize: 15 },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center" },
  hint: { color: "#fff", fontSize: 16, fontWeight: "600", marginBottom: 24 },
  frame: {
    width: 260,
    height: 160,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.9)",
    borderRadius: 16,
  },
  closeBtn: {
    position: "absolute",
    bottom: 60,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 22,
    paddingVertical: 12,
    paddingHorizontal: 30,
  },
  closeBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
