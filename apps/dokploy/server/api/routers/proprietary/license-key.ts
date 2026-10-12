import { hasValidLicense } from "@dokploy/server/index";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";

export const licenseKeyRouter = createTRPCRouter({
	haveValidLicenseKey: protectedProcedure.query(async ({ ctx }) => {
		return await hasValidLicense(ctx.session.activeOrganizationId);
	}),
});
