import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "@avari/shared/styles.css";
import "./web.css";
const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) =>
        !("status" in error && [401, 403].includes(Number(error.status))) &&
        count < 1,
      staleTime: 15000,
      refetchOnWindowFocus: true,
    },
  },
});
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
