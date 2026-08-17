import type {
  BillingAudience,
  BillingCatalogVersionDefinition,
  BillingCouponEligibilityResult,
  BillingCouponPolicy,
  BillingCycle,
  BillingCatalogMutationProvenance,
  BillingPaymentMethod,
} from "./catalogPolicy";

export type BillingCatalogProductRecord = {
  id: string;
  code: string;
  audience: BillingAudience;
  name: string;
  description: string | null;
  state: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
};

export type BillingCatalogVersionRecord = BillingCatalogVersionDefinition & {
  id: string;
  productId: string;
  productState: "active" | "inactive";
  description: string | null;
  createdByUserId: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BillingPublicCatalogVersion = Pick<
  BillingCatalogVersionRecord,
  | "productCode"
  | "versionCode"
  | "version"
  | "audience"
  | "name"
  | "description"
  | "billingCycle"
  | "currency"
  | "unitAmount"
  | "capacityLimit"
  | "entitlements"
  | "coveredBeneficiaryEntitlements"
  | "commercialPaymentMethods"
  | "effectiveFrom"
  | "effectiveUntil"
  | "sortOrder"
> & {
  effectivePaymentMethods: BillingPaymentMethod[];
};

export type BillingCouponRecord = BillingCouponPolicy & {
  id: string;
  revision: number;
  state: "active" | "inactive";
  supersedesCouponId: string | null;
  createdByUserId: number | null;
  deactivatedByUserId: number | null;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BillingCouponUsageStats = {
  totalConfirmedOrReserved: number;
  userConfirmedOrReserved: number;
  userHasPriorPaidContract: boolean;
};

export type BillingCouponReservation = {
  id: string;
  couponId: string;
  userId: number;
  contractKey: string;
  state: "reserved" | "confirmed" | "canceled";
  discountAmount: number;
  finalAmount: number;
  created: boolean;
};

export type CreateBillingCatalogProductInput = {
  code: string;
  audience: BillingAudience;
  name: string;
  description?: string | null;
  actorUserId: number;
  reason: string;
  provenance: BillingCatalogMutationProvenance;
};

export type CreateBillingCatalogVersionInput = {
  productCode: string;
  name: string;
  description?: string | null;
  billingCycle: BillingCycle;
  currency: "BRL";
  unitAmount: number;
  capacityLimit: number | null;
  entitlements: readonly string[];
  coveredBeneficiaryEntitlements: readonly string[];
  commercialPaymentMethods: readonly BillingPaymentMethod[];
  effectiveFrom: Date;
  effectiveUntil?: Date | null;
  sortOrder: number;
  actorUserId: number;
  reason: string;
  provenance: BillingCatalogMutationProvenance;
};

export type PublishBillingCatalogVersionInput = {
  versionCode: string;
  effectiveFrom: Date;
  actorUserId: number;
  reason: string;
  provenance: BillingCatalogMutationProvenance;
};

export type DeactivateBillingCatalogVersionInput = {
  versionCode: string;
  effectiveUntil: Date;
  actorUserId: number;
  reason: string;
};

export type CreateBillingCouponRevisionInput = {
  policy: BillingCouponPolicy;
  actorUserId: number;
  reason: string;
};

export type DeactivateBillingCouponInput = {
  code: string;
  actorUserId: number;
  reason: string;
};

export type ReserveBillingCouponInput = {
  userId: number;
  couponCode: string;
  versionCode: string;
  contractKey: string;
  now: Date;
};

export type ReserveBillingCouponResult =
  | {
      reserved: true;
      reservation: BillingCouponReservation;
      eligibility: Extract<BillingCouponEligibilityResult, { eligible: true }>;
    }
  | {
      reserved: false;
      eligibility: Exclude<BillingCouponEligibilityResult, { eligible: true }>;
    };

export type BillingCatalogRepository = {
  listEffectiveVersions(now: Date): Promise<BillingCatalogVersionRecord[]>;
  listAllVersions(limit: number): Promise<BillingCatalogVersionRecord[]>;
  getVersionByCode(versionCode: string): Promise<BillingCatalogVersionRecord | null>;
  listCoupons(limit: number): Promise<BillingCouponRecord[]>;
  getActiveCouponByCode(code: string): Promise<BillingCouponRecord | null>;
  getCouponUsageStats(
    couponId: string,
    userId: number
  ): Promise<BillingCouponUsageStats>;
  createProduct(
    input: CreateBillingCatalogProductInput
  ): Promise<BillingCatalogProductRecord>;
  createVersion(
    input: CreateBillingCatalogVersionInput
  ): Promise<BillingCatalogVersionRecord>;
  publishVersion(
    input: PublishBillingCatalogVersionInput
  ): Promise<BillingCatalogVersionRecord>;
  deactivateVersion(
    input: DeactivateBillingCatalogVersionInput
  ): Promise<BillingCatalogVersionRecord>;
  createCouponRevision(
    input: CreateBillingCouponRevisionInput
  ): Promise<BillingCouponRecord>;
  deactivateCoupon(input: DeactivateBillingCouponInput): Promise<BillingCouponRecord>;
  reserveCoupon(input: ReserveBillingCouponInput): Promise<ReserveBillingCouponResult>;
  seedInitialCatalog(
    definitions: readonly BillingCatalogVersionDefinition[]
  ): Promise<{ products: number; versions: number }>;
};

export type BillingCatalogCapabilitiesProvider = () =>
  | readonly string[]
  | Promise<readonly string[]>;
