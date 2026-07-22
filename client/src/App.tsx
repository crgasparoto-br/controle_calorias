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
import PatientProfessionalProfilesEmbed from "./components/PatientProfessionalProfilesEmbed";
import ProfessionalEntitlementGate from "./components/ProfessionalEntitlementGate";
import ProfileWhatsappGreetingVisibility from "./components/ProfileWhatsappGreetingVisibility";
import { ThemeProvider } from "./contexts/ThemeContext";
import { trackEvent } from "./lib/analytics";
import { professionalResourceForPath } from "./lib/professionalRoutes";

export { professionalResourceForPath } from "./lib/professionalRoutes";

const AdminPage = lazy(() => import("@/pages/AdminPage"));
const ChannelsPage = lazy(() => import("@/pages/ChannelsPage"));
const FoodsPage = lazy(() => import("@/pages/FoodsPage"));
const GoalsPage = lazy(() => import("@/pages/GoalsPage"));
const HealthIntegrationsPage = lazy(
  () => import("@/pages/HealthIntegrationsPage")
);
const Home = lazy(() => import("@/pages/Home"));
const LogMealPage = lazy(() => import("@/pages/LogMealPage"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const OnboardingPage = lazy(() => import("@/pages/OnboardingPage"));
const SettingsPageRouter = lazy(() => import("@/pages/SettingsPageRouter"));
const ProfessionalSettingsPage = lazy(
  () => import("@/pages/ProfessionalSettingsPage")
);
const ProfessionalAreaPage = lazy(
  () => import("@/pages/ProfessionalAreaPage")
);
const QuickEditExercisePage = lazy(
  () => import("@/pages/QuickEditExercisePage")
);
const QuickEditMealPage = lazy(() => import("@/pages/QuickEditMealPage"));
const RegisterPage = lazy(() => import("@/pages/RegisterPage"));
const RegisteredMealsPage = lazy(() => import("@/pages/RegisteredMealsPage"));
const ReportsPage = lazy(() => import("@/pages/ReportsPage"));
const SyncedHealthDataPage = lazy(() => import("@/pages/SyncedHealthDataPage"));
const WhatsappOnboardingPage = lazy(
  () => import("@/pages/WhatsappOnboardingPage")
);

function PageLoadingFallback() {
  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      Carregando tela...
    </div>
  );
}

function ProfessionalRedirect({ destination }: { destination: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => setLocation(destination), [destination, setLocation]);
  return <PageLoadingFallback />;
}

function RetiredProfessionalBookmarkRedirect() {
  return <ProfessionalRedirect destination="/professional" />;
}

function RetiredProfessionalFollowUpRedirect() {
  return <ProfessionalRedirect destination="/professional/patients" />;
}

function ProfessionalWorkspaceRoute() {
  const [location] = useLocation();
  return (
    <ProfessionalEntitlementGate
      resource={professionalResourceForPath(location)}
    >
      <ProfessionalAreaPage />
    </ProfessionalEntitlementGate>
  );
}

function ProfessionalSettingsRoute() {
  return (
    <ProfessionalEntitlementGate resource="professional_settings">
      <ProfessionalSettingsPage />
    </ProfessionalEntitlementGate>
  );
}

function Router() {
  const [location] = useLocation();
  useEffect(() => {
    if (location === "/" || location === "/today")
      trackEvent("daily_dashboard_viewed", { surface: "home" });
    if (location === "/reports")
      trackEvent("weekly_report_viewed", { report_type: "progress" });
  }, [location]);
  return (
    <Suspense fallback={<PageLoadingFallback />}>
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/register" component={RegisterPage} />
        <Route
          path="/quick-edit/exercise/:token"
          component={QuickEditExercisePage}
        />
        <Route path="/quick-edit/:token" component={QuickEditMealPage} />
        <Route
          path="/onboarding/whatsapp/:token"
          component={WhatsappOnboardingPage}
        />
        <Route path="/" component={Home} />
        <Route path="/today" component={Home} />
        <Route path="/onboarding" component={OnboardingPage} />
        <Route path="/settings" component={SettingsPageRouter} />
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
        <Route
          path="/professional/legacy"
          component={RetiredProfessionalBookmarkRedirect}
        />
        <Route
          path="/professional/follow-up"
          component={RetiredProfessionalFollowUpRedirect}
        />
        <Route
          path="/professional/patients/:patientId/assessment"
          component={ProfessionalWorkspaceRoute}
        />
        <Route
          path="/professional/patients/:patientId/goals"
          component={ProfessionalWorkspaceRoute}
        />
        <Route
          path="/professional/patients/:patientId/guidance"
          component={ProfessionalWorkspaceRoute}
        />
        <Route
          path="/professional/patients/:patientId/notes"
          component={ProfessionalWorkspaceRoute}
        />
        <Route
          path="/professional/patients/:patientId/history"
          component={ProfessionalWorkspaceRoute}
        />
        <Route
          path="/professional/patients/:patientId/reports"
          component={ProfessionalWorkspaceRoute}
        />
        <Route
          path="/professional/patients/:patientId/messages"
          component={ProfessionalWorkspaceRoute}
        />
        <Route
          path="/professional/patients/:patientId"
          component={ProfessionalWorkspaceRoute}
        />
        <Route
          path="/professional/patients"
          component={ProfessionalWorkspaceRoute}
        />
        <Route
          path="/professional/messages"
          component={ProfessionalWorkspaceRoute}
        />
        <Route
          path="/professional/reports"
          component={ProfessionalWorkspaceRoute}
        />
        <Route
          path="/professional/settings"
          component={ProfessionalSettingsRoute}
        />
        <Route path="/professional" component={ProfessionalWorkspaceRoute} />
        <Route path="/admin" component={AdminPage} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <ProfileWhatsappGreetingVisibility />
          <NutritionGoalPreviewValidityBridge />
          <NutritionGoalReportInvalidator />
          <PatientGoalSuggestionsEmbed />
          <PatientProfessionalProfilesEmbed />
          <PatientProfessionalGuidancesEmbed />
          <PatientProfessionalMessagesEmbed />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
