import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Shard from "./app/Shard";

const App = () => (
  <TooltipProvider>
    <Toaster />
    <Sonner />
    <Shard />
  </TooltipProvider>
);

export default App;
