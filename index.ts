// react-native-gesture-handler MUST be the very first import in the entry file.
// Its side-effecting import installs the native gesture handler before anything
// else mounts; importing it later (or only inside a screen) leaves gestures dead.
import "react-native-gesture-handler";

import { registerRootComponent } from 'expo';
import { createElement } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import App from './App';

// gesture-handler requires a GestureHandlerRootView at the app root. App.tsx has
// three conditional returns (loading / onboarding / main), so rather than refactor
// its body we wrap the whole App here via createElement (index.ts is .ts, no JSX).
// NOTE: this root wrapper covers the main app tree only. Each RN <Modal> hosts its
// children in a SEPARATE native view tree that is NOT under this provider, so every
// sheet Modal wraps its OWN GestureHandlerRootView (see screens/*). Without that,
// in-Modal gestures silently do nothing.
function Root() {
  return createElement(
    GestureHandlerRootView,
    { style: { flex: 1 } },
    createElement(App)
  );
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => Root);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(Root);
