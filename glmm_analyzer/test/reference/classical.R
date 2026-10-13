# Reference values for test/classical.test.mjs: R's own t.test, aov,
# cor.test, cor(method = "spearman"), anova on lm, chisq.test (no continuity correction), and
# prop.test (no correction) on the small fixed samples the test file carries. Run from anywhere:
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
cx <- c(1.2, 2.5, 3.1, 4.8, 5.0, 6.3, 7.7, 8.1, 9.4, 10.6)
cy <- c(3.0, 2.8, 4.9, 5.2, 7.1, 6.0, 8.8, 9.9, 9.1, 12.4)
ct <- cor.test(cx, cy)
cl <- summary(lm(cy ~ cx))$coefficients
ay <- c(10.1, 12.3, 13.9, 16.2, 11.0, 14.8, 9.5, 11.7, 13.2, 10.4, 8.9, 12.0)
ag <- factor(rep(c("old", "new"), each = 6), levels = c("old", "new"))
ax <- c(5.0, 8.1, 10.2, 13.5, 6.4, 11.0, 4.1, 7.9, 9.8, 6.0, 3.2, 8.4)
aa <- anova(lm(ay ~ ax + ag))
af <- lm(ay ~ ax + ag)
ty <- c(70.1, 72.4, 68.9, 71.5, 75.2, 77.8, 74.0, 76.9, 73.3, 71.0, 72.6, 74.9, 80.2, 83.5, 81.9, 84.1)
ta <- factor(rep(c("low", "high"), each = 8), levels = c("low", "high"))
tb <- factor(rep(rep(c("A", "B"), each = 4), 2))
tw <- anova(lm(ty ~ ta * tb))
sx <- c(1, 2, 2, 3, 5, 5, 5, 8)
sy <- c(2, 1, 4, 4, 6, 7, 5, 9)
sp <- cor(sx, sy, method = "spearman")
gc <- c(16, 9, 12, 10, 26, 8)
gt <- chisq.test(gc)
gG2 <- 2 * sum(gc * log(gc / gt$expected))
out <- list(
  one = list(t = unname(one$statistic), df = unname(one$parameter), p = one$p.value, est = unname(one$estimate), se = unname(one$stderr)),
  pooled = list(t = unname(pooled$statistic), df = unname(pooled$parameter), p = pooled$p.value),
  welch = list(t = unname(welch$statistic), df = unname(welch$parameter), p = welch$p.value),
  anova = list(F = av[["F value"]][1], df1 = av[["Df"]][1], df2 = av[["Df"]][2], p = av[["Pr(>F)"]][1]),
  paired = list(t = unname(paired$statistic), df = unname(paired$parameter), p = paired$p.value, est = unname(paired$estimate)),
  chisq = list(X2 = unname(cs$statistic), df = unname(cs$parameter), p = cs$p.value, G2 = G2, pG = pchisq(G2, cs$parameter, lower.tail = FALSE)),
  prop = list(chisq = unname(pr$statistic), p = pr$p.value, est = unname(pr$estimate)),
  cor = list(r = unname(ct$estimate), t = unname(ct$statistic), df = unname(ct$parameter), p = ct$p.value, slope = cl["cx", "Estimate"], seSlope = cl["cx", "Std. Error"], intercept = cl["(Intercept)", "Estimate"]),
  ancova = list(F = aa["ag", "F value"], df = aa["ag", "Df"], p = aa["ag", "Pr(>F)"], ss = aa["ag", "Sum Sq"], ssResidual = aa["Residuals", "Sum Sq"], dfResidual = aa["Residuals", "Df"], slope = unname(coef(af)["ax"]), adjustedDiff = unname(coef(af)["agnew"])),
  twoway = list(ss = tw[["Sum Sq"]], df = tw[["Df"]], F = tw[["F value"]][1:3], p = tw[["Pr(>F)"]][1:3]),
  spearman = list(rho = sp, ranks = rank(sx)),
  gof = list(X2 = unname(gt$statistic), df = unname(gt$parameter), p = gt$p.value, G2 = gG2, pG = pchisq(gG2, gt$parameter, lower.tail = FALSE), expected = gt$expected[1])
)
cat(jsonlite::toJSON(out, auto_unbox = TRUE, digits = NA))
