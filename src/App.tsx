import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigate, Outlet, ScrollRestoration, createBrowserRouter, RouterProvider } from "react-router";

import { Toaster } from "@/components/ui/sonner";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { requireSession } from "@/components/auth/require-session";
import AuthPage from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import Landing from "@/pages/Landing";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

function RootLayout() {
  return (
    <>
      {/* Required: nested routes render here. */}
      <Outlet />
      <Toaster />
      <ScrollRestoration />
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: "/", element: <Landing /> },
      { path: "/sign-in", element: <AuthPage mode="signin" /> },
      { path: "/sign-up", element: <AuthPage mode="signup" /> },
      { path: "/app", loader: requireSession, element: <Dashboard /> },
      // Legacy URLs from the previous version of the site.
      { path: "/auth", element: <Navigate to="/sign-in" replace /> },
      { path: "/dashboard", element: <Navigate to="/app" replace /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
