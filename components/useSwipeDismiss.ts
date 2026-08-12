// Swipe-down-to-dismiss for bottom-sheet modals — react-native-gesture-handler
// for the gesture, plain RN `Animated` for the transform.
//
// WHY gesture-handler (not PanResponder):
//   PanResponder produced ZERO move events inside a Fabric (New Architecture)
//   RN `Modal` sitting over a native `ScrollView` — the dismiss simply never
//   fired. gesture-handler's `Gesture.Pan()` works reliably there. It's bundled
//   in Expo Go SDK 54, so it lights up on a plain JS reload (no native rebuild)
//   and rides along in the next normal EAS build. We deliberately do NOT use
//   react-native-reanimated: gesture-handler's gesture callbacks run on the JS
//   thread, so `translateY.setValue(...)` from a plain RN `Animated.Value` works
//   directly in `.onUpdate` / `.onEnd`.
//
// CRITICAL per-Modal requirement:
//   A core RN `<Modal>` hosts its children in a SEPARATE native view tree that is
//   NOT under the app-root GestureHandlerRootView (set in index.ts). So EVERY
//   sheet must wrap its Modal content in its OWN `<GestureHandlerRootView style={{
//   flex: 1 }}>` (just inside <Modal>, around the KeyboardAvoidingView). Without
//   that wrapper the gesture is silently dead. This is the #1 "RNGH-in-Modal does
//   nothing" gotcha.
//
// Usage:
//   const swipe = useSwipeDismiss({ visible: addOpen, onClose: () => setAddOpen(false) });
//   ...
//   <Modal ...>
//     <GestureHandlerRootView style={{ flex: 1 }}>
//       <KeyboardAvoidingView ...>
//         <GestureDetector gesture={swipe.gesture}>
//           <Animated.View style={[styles.sheetCard, swipe.sheetAnimStyle]}>
//             <DragHandle />
//             <View style={styles.sheetHeader}>…× button…</View>
//             <ScrollView {...swipe.scrollViewProps}>…</ScrollView>
//           </Animated.View>
//         </GestureDetector>
//       </KeyboardAvoidingView>
//     </GestureHandlerRootView>
//   </Modal>
//
// WHY it doesn't fight the inner ScrollView OR the app's horizontal tab swipe:
//   - .activeOffsetY(12): the pan only begins after a clear DOWNWARD drag, so
//     taps and tiny moves (× button, BACK, chips, inputs) pass straight through.
//   - .failOffsetX([-20, 20]): if horizontal movement dominates, the pan bails so
//     it never fights the app's horizontal tab swipe.
//   - We only MOVE/dismiss the sheet when the inner ScrollView is at the very top
//     (scrollYRef <= 0). Once the user has scrolled into content, the ScrollView
//     owns the vertical gesture. Spread `scrollViewProps` on each sheet's
//     ScrollView so the hook can track its offset.
//   - `bounces: false` keeps the at-top offset clean so a top-of-sheet down-drag
//     dismisses instead of rubber-banding.
//
// KNOWN EDGE CASE (intentional, not a bug):
//   We do NOT use .simultaneousWithExternalGesture here. RNGH v2's
//   simultaneousWithExternalGesture wants a gesture ref or an RNGH-aware
//   component ref, not a plain core RN `ScrollView` ref (it doesn't type-check
//   and wouldn't compose cleanly). Instead we gate purely on scroll offset:
//   .activeOffsetY(12) means the pan only claims a deliberate downward drag, and
//   .onUpdate/.onEnd only move or dismiss when scrollYRef <= 0 (scrolled to top).
//   The one cost: if you START a downward drag while scrolled DOWN into content,
//   the pan may briefly claim the touch before the scroll-gate no-ops it, so that
//   first drag can feel momentarily stuck. Lifting and dragging again from the top
//   works normally. This was judged acceptable vs. blocking on perfection; the
//   common case (drag down from the top of an at-rest sheet) dismisses cleanly.

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Animated } from "react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { Gesture } from "react-native-gesture-handler";

// Tuning constants. Kept here so all sheets feel identical.
const DISMISS_DISTANCE = 110; // drag past this on release => dismiss
// gesture-handler velocity is px/SECOND (PanResponder's vy was px/ms). 800 px/s
// is a deliberate, easy downward fling.
const DISMISS_VELOCITY_PXS = 800;
const OFFSCREEN = 800; // how far down to animate before calling onClose

type Args = {
  visible: boolean;
  onClose: () => void;
};

export function useSwipeDismiss({ visible, onClose }: Args) {
  // translateY drives the sheetCard transform. 0 = resting (fully open).
  const translateY = useRef(new Animated.Value(0)).current;

  // Keep the latest onClose without re-reading a stale closure inside callbacks.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Live scroll offset of the sheet's ScrollView. We only let a downward drag
  // dismiss the sheet when content is scrolled to the top; otherwise the
  // ScrollView owns the vertical gesture. Default 0 = top (sheets open at top).
  const scrollYRef = useRef(0);

  // Animate the sheet off the bottom, then fire onClose — and leave the card PARKED
  // off-screen. We deliberately do NOT reset translateY in this completion callback.
  //
  // WHY no close-time reset (the old code snapped translateY back to 0 here):
  //   The RN <Modal animationType="slide"> is still playing its OWN slide-out at the
  //   moment this callback fires. If we also snap our transform from OFFSCREEN back
  //   to 0 (resting) here, the card visibly re-appears at rest mid-slide-out — the
  //   reported FLASH: card slides off (gone) → snaps to rest (re-appears) → modal
  //   finishes sliding out (gone again). Parking the card off-screen and letting the
  //   `visible` effect (below) own the reopen reset gives a single clean dismissal.
  //
  // WHY useNativeDriver:false (transform lives on the JS thread):
  //   The reopen reset is done by the `visible` effect's translateY.setValue(0).
  //   Under the native driver the value is owned by native after a useNativeDriver:
  //   true animation, so a fresh Modal mount could render the stale ~OFFSCREEN value
  //   (the "stuck at the bottom" bug) before/instead of the JS setValue taking hold.
  //   With useNativeDriver:false the value lives purely on the JS thread — same
  //   thread the drag's translateY.setValue already uses — so the reopen setValue(0)
  //   reliably takes effect on the next frame. Slide perf on the JS thread is fine
  //   for a single bottom sheet.
  //
  // Stable identity (useCallback []): the body only touches stable refs
  // (translateY, onCloseRef) and module constants — no stale-closure risk — which
  // lets the memoized gesture below keep a stable identity too.
  // velocityPxs is px/SECOND (gesture-handler units).
  const animateOut = useCallback(
    (velocityPxs = DISMISS_VELOCITY_PXS) => {
      // Faster flings get a snappier exit. Convert px/s back into the same feel the
      // old px/ms tuning had: divide by 1000 so a ~2000 px/s fling subtracts ~240ms.
      const duration = Math.max(140, Math.min(260, 260 - (velocityPxs / 1000) * 120));
      Animated.timing(translateY, {
        toValue: OFFSCREEN,
        duration,
        useNativeDriver: false,
      }).start(() => {
        // Only fire onClose. Card stays parked at OFFSCREEN (invisible) while the
        // Modal slides out; the `visible` effect resets it before the next open.
        onCloseRef.current();
      });
    },
    [translateY],
  );

  const snapBack = useCallback(() => {
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: false,
      bounciness: 4,
    }).start();
  }, [translateY]);

  // Track the sheet's ScrollView offset so the pan knows when we're at top.
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = e.nativeEvent.contentOffset.y;
  };

  // The pan gesture. MEMOIZED so its identity is STABLE across renders. Rebuilding
  // a Gesture.Pan() object every render is a documented react-native-gesture-handler
  // footgun: GestureDetector re-registers on each new gesture identity and can leave
  // a dangling/active gesture that swallows every touch, freezing the page. The
  // callbacks only close over stable refs (translateY, scrollYRef via the stable
  // animateOut/snapBack) and module constants, so the [animateOut, snapBack] deps —
  // both stable useCallback([]) values — keep this gesture's identity constant for
  // the component's lifetime, with no stale-closure risk.
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(12) // begin only after a clear DOWNWARD drag (taps pass through)
        .failOffsetX([-20, 20]) // bail if horizontal dominates (don't fight tab swipe)
        .onUpdate((e) => {
          // Follow the finger downward only, and only while scrolled to the top.
          if (scrollYRef.current <= 0 && e.translationY > 0) {
            translateY.setValue(e.translationY);
          }
        })
        .onEnd((e) => {
          const atTop = scrollYRef.current <= 0;
          if (
            atTop &&
            (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY_PXS)
          ) {
            animateOut(e.velocityY);
          } else {
            snapBack();
          }
        }),
    [animateOut, snapBack, translateY],
  );

  // Reset to resting whenever the sheet (re)opens. This is now the SOLE reset —
  // animateOut parks the card off-screen and does NOT reset on close (that caused
  // the dual-animation flash, see animateOut above). Under useNativeDriver:false the
  // transform lives on the JS thread, so this setValue(0) reliably takes effect on
  // the next frame: no stuck-at-bottom on reopen, no close-time snap-back flash.
  // Independent of the app's active-prop modal-mount gating: it only touches the
  // transform value, not the Modal's `visible`, so it can't strand or fight that
  // pattern.
  useEffect(() => {
    if (visible) {
      translateY.setValue(0);
      scrollYRef.current = 0;
    }
  }, [visible, translateY]);

  // Lets the × button (optionally) reuse the same slide-down exit animation.
  const handleClose = () => animateOut();

  return {
    // Pass to <GestureDetector gesture={...}> wrapping the sheet card.
    gesture,
    sheetAnimStyle: { transform: [{ translateY }] },
    // Spread on the sheet's ScrollView so the hook can see its scroll position.
    // bounces:false keeps the at-top offset clean so a top down-drag dismisses
    // instead of rubber-banding.
    scrollViewProps: {
      onScroll,
      scrollEventThrottle: 16,
      bounces: false,
    },
    handleClose,
  };
}
