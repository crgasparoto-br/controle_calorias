import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import React, { lazy, Suspense, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import NutritionGoalPreviewValidityBridge from "./components/NutritionGoalPreviewValidityBridge";
import NutritionGoalReportInvalidator from "./components/NutritionGoalReportInvalidator";
import PatientGoalSuggestionsEmbed from "./components/PatientGoalSuggestionsEmbed";
import PatientProfessionalGuidancesEmbed from "./components/PatientProfessionalGuidancesEmbed";
import PatientProfessionalMessagesEmbed from "./components/PatientProfessionalMessagesEmbed";
import ProfessionalAnalyzeTabBridge from "./components/ProfessionalAnalyzeTabBridge";
import ProfessionalEntitlementGate from "./components/ProfessionalEntitlementGate";
import ProfessionalGoalExceptionSuggestionsEmbed from "./components/ProfessionalGoalExceptionSuggestionsEmbed";
import ProfessionalOperationalAlertsBridge from "./components/ProfessionalOperationalAlertsBridge";
import ProfileWhatsappGreetingVisibility from "./components/ProfileWhatsappGreetingVisibility";
import { ThemeProvider } from "./contexts/ThemeContext";
import { trackEvent } from "./lib/analytics";

const AdminPage = lazy(() => import("@/pages/AdminPage"));
const ChannelsPage = lazy(() => import("@/pages/ChannelsPage"));
const FoodsPage = lazy(() => import("@/pages/FoodsPage"));
const GoalsPage = lazy(() => import("@/pages/GoalsPage"));
const HealthIntegrationsPage = lazy(() => import("@/pages/HealthIntegrationsPage"));
const Home = lazy(() => import("@/pages/Home"));
const LogMealPage = lazy(() => import("@/pages/LogMealPage"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const OnboardingPage = lazy(() => import("@/pages/OnboardingPage"));
const ProfessionalSettingsPage = lazy(() => import("@/pages/ProfessionalSettingsPage"));
const ProfessionalWorkspacePage = lazy(() => import("@/pages/ProfessionalWorkspacePage"));
const QuickEditExercisePage = lazy(() => import("@/pages/QuickEditExercisePage"));
const QuickEditMealPage = lazy(() => import("@/pages/QuickEditMealPage"));
const RegisterPage = lazy(() => import("@/pages/RegisterPage"));
const RegisteredMealsPage = lazy(() => import("@/pages/RegisteredMealsPage"));
const ReportsPage = lazy(() => import("@/pages/ReportsPage"));
const SyncedHealthDataPage = lazy(() => import("@/pages/SyncedHealthDataPage"));
const WhatsappOnboardingPage = lazy(() => import("@/pages/WhatsappOnboardingPage"));

function PageLoadingFallback() {
  return <div className="flex min-h-screen items-center justify-center px-4 text-sm text-muted-foreground" role="status" aria-live="polite">Carregando tela...</div>;
}

function LegacyProfessionalRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => setLocation("/professional/reports"), [setLocation]);
  return <PageLoadingFallback />;
}

function ProfessionalWorkspaceRoute() {
  return (
    <ProfessionalEntitlementGate>
      <ProfessionalWorkspacePage />
    </ProfessionalEntitlementGate>
  );
}

function Router() {
  const [location] = useLocation();
  useEffect(() => {
    if (location === "/" || location === "/today") trackEvent("daily_dashboard_viewed", { surface: "home" });
    if (location === "/reports") trackEvent("weekly_report_viewed", { report_type: "progress" });
  }, [location]);
  return <Suspense fallback={<PageLoadingFallback />}><Switch>
    <Route path="/login" component={LoginPage} />
    <Route path="/register" component={RegisterPage} />
    <Route path="/quick-edit/exercise/:token" component={QuickEditExercisePage} />
    <Route path="/quick-edit/:token" component={QuickEditMealPage} />
    <Route path="/onboarding/whatsapp/:token" component={WhatsappOnboardingPage} />
    <Route path="/" component={Home} />
    <Route path="/today" component={Home} />
    <Route path="/onboarding" component={OnboardingPage} />
    <Route path="/settings" component={OnboardingPage} />
    <Route path="/log-meal" component={LogMealPage} />
    <Route path="/record" component={LogMealPage} />
    <Route path="/registrar" component={LogMealPage} />
    <Route path="/meals" component={RegisteredMealsPage} />
    <Route path="/foods" component={FoodsPage} />
    <Route path="/goals" component={GoalsPage} />
    <Route path="/reports" component={ReportsPage} />
    <Route path="/channels" component={ChannelsPage} />
    <Route path="/health-integrations" component={HealthIntegrationsPage} />
    <Route path="/synced-health-data" component={SyncedHealthDataPage} />
    <Route path="/professional/legacy" component={LegacyProfessionalRedirect} />
    <Route path="/professional/patients" component={ProfessionalWorkspaceRoute} />
    <Route path="/professional/follow-up" component={ProfessionalWorkspaceRoute} />
    <Route path="/professional/messages" component={ProfessionalWorkspaceRoute} />
    <Route path="/professional/reports" component={ProfessionalWorkspaceRoute} />
    <Route path="/professional/settings" component={ProfessionalSettingsPage} />
    <Route path="/professional" component={ProfessionalWorkspaceRoute} />
    <Route path="/admin" component={AdminPage} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch></Suspense>;
}

function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider>
    <Toaster />
    <ProfileWhatsappGreetingVisibility />
    <NutritionGoalPreviewValidityBridge />
    <NutritionGoalReportInvalidator />
    <ProfessionalAnalyzeTabBridge />
    <ProfessionalGoalExceptionSuggestionsEmbed />
    <ProfessionalOperationalAlertsBridge />
    <PatientGoalSuggestionsEmbed />
    <PatientProfessionalGuidancesEmbed />
    <PatientProfessionalMessagesEmbed />
    <Router />
  </TooltipProvider></ThemeProvider></ErrorBoundary>;
}

export default App;
