import { CompareWorkbench } from "@/components/compare-workbench";
import { sampleComparison } from "@/lib/sample";

export default function CmuxVsOttyExample() {
  return (
    <CompareWorkbench exampleMode initialResult={sampleComparison} />
  );
}
