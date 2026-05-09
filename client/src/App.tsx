import { Switch, Route } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Admin from "@/pages/admin";
import BarbersPage from "@/pages/barbers";
import LocationPage from "@/pages/location";
import ServicesPage from "@/pages/services";
import QueuePage from "@/pages/queue";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/admin" component={Admin} />
      <Route path="/barbers" component={BarbersPage} />
      <Route path="/location" component={LocationPage} />
      <Route path="/services" component={ServicesPage} />
      <Route path="/queue" component={QueuePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </AuthProvider>
  );
}

export default App;