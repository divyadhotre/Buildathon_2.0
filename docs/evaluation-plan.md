# Evaluation Plan

Use a small, labelled, synthetic invoice set. Record expected field values and expected flags before running tests.

## Test categories
1. Clean digital PDF.
2. Scanned image/PDF.
3. Missing required field.
4. Arithmetic mismatch.
5. Possible duplicate.
6. Corrupt/unsupported file.
7. Reviewer correction and version preservation.
8. Unauthorized decision attempt.
9. Approval/rejection reason and history.
10. Explanation with evidence and no unsupported claims.

## Report
- Dataset size and how examples were created.
- Field-level extraction accuracy.
- Rule-level precision/recall where labels exist.
- Failure-routing behavior.
- Review-time baseline and assisted time, only if measured fairly.
- Known limitations and false positives.

Do not report invented accuracy, latency, or productivity metrics.
