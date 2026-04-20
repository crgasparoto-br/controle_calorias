import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import AdminPage from "@/pages/AdminPage";
import ChannelsPage from "@/pages/ChannelsPage";
import GoalsPage from "@/pages/GoalsPage";
import Home from "@/pages/Home";
import LogMealPage from "@/pages/LogMealPage";
import NotFound from "@/pages/NotFound";
import ReportsPage from "@/pages/ReportsPage";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/log-meal" component={LogMealPage} />
      <Route path="/goals" component={GoalsPage} />
      <Route path="/reports" component={ReportsPage} />
      <Route path="/channels" component={ChannelsPage} />
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
