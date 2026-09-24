import { lazy, Suspense } from "react";
import { FieldFallback } from "./FieldFallback";
import type { MosaicFieldProps } from "./MosaicField";

const MosaicFieldImpl = lazy(() => import("./MosaicField"));

/**
 * Code-split `MosaicField`: neither the component nor three.js is in the
 * importing page's bundle. Until both arrive (and if WebGL is unavailable)
 * a token-based CSS gradient fills the same box, so layout never shifts.
 */
export function LazyMosaicField(props: MosaicFieldProps) {
  return (
    <Suspense
      fallback={
        <FieldFallback variant={props.variant} className={props.className} />
      }
    >
      <MosaicFieldImpl {...props} />
    </Suspense>
  );
}
