export {
  grantTemporaryAllowance,
  openUsageAbuseCase,
  reviewUsageAbuseCase,
  applyUsageLimitation,
  submitUsageLimitationAppeal,
  resolveUsageLimitationAppeal,
  placeUsageLegalHold,
} from "./adminServiceCore";

import { usageGovernanceAdminService as coreService } from "./adminServiceCore";
import {
  activateFutureConsumptionCharging as activateFlow,
  approveFutureConsumptionCharging as approveFlow,
  authorizeFutureConsumptionCharging as authorizeFlow,
  revokeFutureConsumptionCharging as revokeFlow,
  suspendFutureConsumptionCharging as suspendFlow,
} from "./consumptionChargeAdmin";

export const authorizeFutureConsumptionCharging = authorizeFlow;
export const approveFutureConsumptionCharging = approveFlow;
export const activateFutureConsumptionCharging = activateFlow;
export const suspendFutureConsumptionCharging = suspendFlow;
export const revokeFutureConsumptionCharging = revokeFlow;

export const usageGovernanceAdminService = {
  ...coreService,
  authorizeFutureConsumptionCharging,
  approveFutureConsumptionCharging,
  activateFutureConsumptionCharging,
  suspendFutureConsumptionCharging,
  revokeFutureConsumptionCharging,
};
