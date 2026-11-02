import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Shard from "./app/Shard";

const App = () => (
  <TooltipProvider>
    <Sonner />
    <Shard />
  </TooltipProvider>
);

export default App;
