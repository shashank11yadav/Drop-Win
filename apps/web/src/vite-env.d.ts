/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the API when it is not served from the same origin as the app. */
  readonly VITE_API_BASE?: string;
  /** 'browser' runs the house in a Web Worker (the static demo); anything else uses the API. */
  readonly VITE_BACKEND?: string;
}
