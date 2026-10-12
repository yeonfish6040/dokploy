import { db } from "@dokploy/server/db";
import { organization, organizationRole } from "@dokploy/server/db/schema";
import { and, eq } from "drizzle-orm";

export const hasValidLicense = async (
	_organizationId: string,
): Promise<boolean> => true;

export const resolveOrganizationDefaultRole = async (
	organizationId: string,
) => {
	const org = await db.query.organization.findFirst({
		where: eq(organization.id, organizationId),
		columns: { defaultRole: true },
	});
	const defaultRole = org?.defaultRole;

	if (!defaultRole || defaultRole === "owner") {
		return "member";
	}

	if (defaultRole === "admin" || defaultRole === "member") {
		return defaultRole;
	}

	const customRole = await db.query.organizationRole.findFirst({
		where: and(
			eq(organizationRole.organizationId, organizationId),
			eq(organizationRole.role, defaultRole),
		),
		columns: { id: true },
	});

	if (!customRole || !(await hasValidLicense(organizationId))) {
		return "member";
	}

	return defaultRole;
};
