import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthGate } from "./auth/AuthGate";
import { installApiFetchInterceptor } from "./auth/session";
import { SurveyPage } from "./modules/encuesta/SurveyPage";
import "./index.css";

installApiFetchInterceptor();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* La encuesta es pública (enlace firmado del correo); el resto del panel exige sesión. */}
    {window.location.pathname.startsWith("/encuesta") ? (
      <SurveyPage />
    ) : (
      <AuthGate>{(session, onLogout) => <App user={session.user} authEnabled={session.authEnabled} onLogout={onLogout} />}</AuthGate>
    )}
  </React.StrictMode>
);
