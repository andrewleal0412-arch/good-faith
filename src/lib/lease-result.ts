import { evaluateLease, lawfulDeposit, smallLandlordExempt, totalSecurity, type LeaseTerms } from "./rules";
import { isSupported, packFor, stateCode, unsupportedMessage } from "./states";

// What the lease page gets back for a lease's terms, whether Claude just read them (api/lease) or they are the sample
// lease's, read when the demo was built (api/lease/sample): the state the lease names (else the one its address
// ends with), whether a rule pack covers it, and that pack's flags and lawful deposit. The page draws both the same.
export function leaseResult(terms: LeaseTerms, leasePath: string | null) {
  const state = stateCode(terms.state) ?? stateCode(terms.propertyAddress);
  terms.state = state;
  const supported = isSupported(state);
  const pack = supported ? packFor(state) : null;
  return {
    leasePath,
    state, supported, refusal: supported ? null : unsupportedMessage(state),
    lawfulDeposit: pack ? lawfulDeposit(terms, pack) : null,
    terms,
    totalSecurity: totalSecurity(terms),
    smallLandlordExempt: smallLandlordExempt(terms),
    flags: pack ? evaluateLease(terms, pack) : [],
  };
}
