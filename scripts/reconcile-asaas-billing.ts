import "dotenv/config";
import {
  configureAsaasBillingRuntime,
  reconcileAsaasBilling,
  reconcileAsaasContract,
} from "../server/modules/billing/asaas/runtime";
import { configureAsaasBillingLifecycleHooks } from "../server/modules/billing/asaas/remediationRuntime";
import {
  reconcileAsaasPixAuthorizationContract,
  reconcileAsaasUnknownPixAuthorizations,
} from "../server/modules/billing/asaas/pixAuthorizationRecovery";

configureAsaasBillingRuntime();
configureAsaasBillingLifecycleHooks();

const contractKey = process.argv[2]?.trim();
const result = contractKey
  ? {
      billing: await reconcileAsaasContract(contractKey),
      pixAuthorization: await reconcileAsaasPixAuthorizationContract(contractKey),
    }
  : {
      billing: await reconcileAsaasBilling(200),
      pixAuthorization: await reconcileAsaasUnknownPixAuthorizations(200),
    };

console.log(JSON.stringify(result));
