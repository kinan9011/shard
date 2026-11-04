import { DirectionProvider } from "@radix-ui/react-direction";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLocale } from "@/i18n";
import Shard from "./app/Shard";

const App = () => {
  const { dir } = useLocale();
  return (
    <DirectionProvider dir={dir}>
      <TooltipProvider>
        <Sonner />
        <Shard />
      </TooltipProvider>
    </DirectionProvider>
  );
};

export default App;
