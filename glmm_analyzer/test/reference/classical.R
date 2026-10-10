# Reference values for test/classical.test.mjs: R's own t.test, aov,
# chisq.test (no continuity correction), and prop.test (no correction) on
# the small fixed samples the test file carries. Run from anywhere:
#   Rscript glmm_analyzer/test/reference/classical.R > glmm_analyzer/test/reference/classical.json
x <- c(5.1, 4.8, 6.2, 5.5, 4.9, 5.8, 6.1, 5.0, 5.4, 4.7)
y <- c(6.0, 6.4, 5.9, 7.1, 6.6, 6.2, 5.8, 6.9)
one <- t.test(x, mu = 5)
pooled <- t.test(x, y, var.equal = TRUE)
welch <- t.test(x, y)
g <- factor(rep(c("a", "b", "c"), each = 5))
v <- c(2.1, 2.5, 1.9, 2.8, 2.2, 3.0, 2.7, 3.4, 3.1, 2.9, 2.4, 2.0, 2.6, 2.3, 2.7)
av <- summary(aov(v ~ g))[[1]]
before <- c(10.2, 9.8, 11.1, 10.5, 9.9, 10.8, 10.1, 9.6)
after <- c(10.9, 10.1, 11.8, 10.9, 10.2, 11.5, 10.0, 10.3)
paired <- t.test(before, after, paired = TRUE)
tab <- matrix(c(12, 20, 8, 15, 9, 24), nrow = 2, byrow = TRUE)
cs <- chisq.test(tab, correct = FALSE)
G2 <- 2 * sum(tab * log(tab / cs$expected))
pr <- prop.test(c(14, 22), c(40, 45), correct = FALSE)
out <- list(
  one = list(t = unname(one$statistic), df = unname(one$parameter), p = one$p.value, est = unname(one$estimate), se = unname(one$stderr)),
  pooled = list(t = unname(pooled$statistic), df = unname(pooled$parameter), p = pooled$p.value),
  welch = list(t = unname(welch$statistic), df = unname(welch$parameter), p = welch$p.value),
  anova = list(F = av[["F value"]][1], df1 = av[["Df"]][1], df2 = av[["Df"]][2], p = av[["Pr(>F)"]][1]),
  paired = list(t = unname(paired$statistic), df = unname(paired$parameter), p = paired$p.value, est = unname(paired$estimate)),
  chisq = list(X2 = unname(cs$statistic), df = unname(cs$parameter), p = cs$p.value, G2 = G2, pG = pchisq(G2, cs$parameter, lower.tail = FALSE)),
  prop = list(chisq = unname(pr$statistic), p = pr$p.value, est = unname(pr$estimate))
)
cat(jsonlite::toJSON(out, auto_unbox = TRUE, digits = NA))
