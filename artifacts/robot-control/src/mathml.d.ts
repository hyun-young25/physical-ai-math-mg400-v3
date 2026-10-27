import type { DetailedHTMLProps, HTMLAttributes } from "react";

// The browser already renders these MathML tags; declare their JSX attributes
// for the React typings used by this workspace, without changing the content.
type MathMLProps = DetailedHTMLProps<HTMLAttributes<MathMLElement>, MathMLElement>;
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      math: MathMLProps;
      mi: MathMLProps;
      mo: MathMLProps;
      mn: MathMLProps;
      mrow: MathMLProps;
      msqrt: MathMLProps;
      msup: MathMLProps;
    }
  }
}
