import type { SceneController } from '../../src/scene/SceneController';
import type { useStore } from '../../src/state/store';

declare global {
  interface Window {
    __scene?: SceneController;
    __store?: typeof useStore;
  }
}
export {};
