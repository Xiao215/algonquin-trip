// Public settings for the page. These ship to every visitor, so no secrets here.
window.TRIP_CONFIG = {
  // Chat backend: your machine's Tailscale Funnel URL (printed by ./start.sh).
  // For local testing, open the page with ?api=http://localhost:8790 (only localhost overrides are accepted).
  apiBase: "https://xiaos-macbook-pro.tail3d8516.ts.net:8443",

  // Google Maps JavaScript API key, restricted to your GitHub Pages site (see README).
  // Empty = the map still loads, but with a "for development purposes only" watermark.
  googleMapsKey: "",
  // Optional Map ID from Google Cloud (Map Management). Empty uses Google's demo map style.
  googleMapId: ""
};
