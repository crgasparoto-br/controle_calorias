import "dotenv/config";
import {
  configureAsaasBillingRuntime,
  reconcileAsaasBilling,
  reconcileAsaasContract,
} from "../server/modules/billing/asaas/runtime";

configureAsaasBillingRuntime();

const contractKey = process.argv[2]?.trim();
const result = contractKey
  ? await reconcileAsaasContract(contractKey)
  : await reconcileAsaasBilling(200);

console.log(JSON.stringify(result));
