import { useSyncExternalStore } from "react";
import { squareVisualSnapshot,subscribeSquareVisual } from "./squareVisualizationStore";
export const useSquareVisual=()=>useSyncExternalStore(subscribeSquareVisual,squareVisualSnapshot,squareVisualSnapshot);
