/**
 * The public binding facade only registers a frozen test input.
 * Fixture lookup is private to the synthetic self-test double implementation;
 * candidate resolvers cannot import a generic caseId reader from here.
 */
export { bindCorpusCaseInput } from "./selfTestResolvers.test.support";
