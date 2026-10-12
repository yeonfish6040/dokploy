import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function LicenseKeySettings() {
	return (
		<Card>
			<CardHeader>
				<div className="flex items-center gap-2">
					<ShieldCheck className="size-6 text-green-600" />
					<CardTitle>Enterprise Features Enabled</CardTitle>
				</div>
			</CardHeader>
			<CardContent className="text-sm text-muted-foreground">
				Enterprise features are available on this instance.
			</CardContent>
		</Card>
	);
}
