import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import AdminPage from "@/pages/AdminPage";
import ChannelsPage from "@/pages/ChannelsPage";
import GoalsPage from "@/pages/GoalsPage";
import FoodsPage from "@/pages/FoodsPage";
import Home from "@/pages/Home";
import HealthIntegrationsPage from "@/pages/HealthIntegrationsPage";
import LogMealPage from "@/pages/LogMealPage";
import NotFound from "@/pages/NotFound";
import OnboardingPage from "@/pages/OnboardingPage";
import ProfessionalPage from "@/pages/ProfessionalPage";
import ReportsPage from "@/pages/ReportsPage";
import { useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { trackEvent } from "./lib/analytics";

function Router() {
  const [location] = useLocation();

  useEffect(() => {
    if (location === "/") {
      trackEvent("daily_dashboard_viewed", { surface: "home" });
    }
    if (location === "/reports") {
      trackEvent("weekly_report_viewed", { report_type: "progress" });
    }
    if (location === "/onboarding") {
      trackEvent("onboarding_started", { entry_point: "route" });
    }
  }, [location]);

  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/onboarding" component={OnboardingPage} />
      <Route path="/log-meal" component={LogMealPage} />
      <Route path="/foods" component={FoodsPage} />
      <Route path="/goals" component={GoalsPage} />
      <Route path="/reports" component={ReportsPage} />
      <Route path="/channels" component={ChannelsPage} />
      <Route path="/health-integrations" component={HealthIntegrationsPage} />
      <Route path="/professional" component={ProfessionalPage} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
