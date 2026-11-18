import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./overview.css";

createRoot(document.getElementById("root")!).render(<App />);
// Analytics is optional; do not load an unresolved placeholder URL when it is unconfigured.
const analyticsEndpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT;
const analyticsWebsiteId = import.meta.env.VITE_ANALYTICS_WEBSITE_ID;
if (analyticsEndpoint && analyticsWebsiteId) {
  const analytics = document.createElement("script");
  analytics.defer = true;
  analytics.src = `${analyticsEndpoint.replace(/\/+$/, "")}/umami`;
  analytics.dataset.websiteId = analyticsWebsiteId;
  document.head.appendChild(analytics);
}
