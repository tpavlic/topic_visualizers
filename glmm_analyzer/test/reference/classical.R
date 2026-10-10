# Reference values for test/classical.test.mjs: the classical tests the Tests
# as models page shows beside their models, on small fixed samples. Run from
# anywhere:
#   Rscript glmm_analyzer/test/reference/classical.R > glmm_analyzer/test/reference/classical.json
x <- c(5.1, 4.8, 6.2, 5.5, 4.9, 5.8, 6.1, 5.0, 5.4, 4.7)
y <- c(6.0, 6.4, 5.9, 7.1, 6.6, 6.2, 5.8, 6.9)
g1 <- c(2.1, 2.5, 1.9, 2.8, 2.2); g2 <- c(3.0, 2.7, 3.4, 3.1, 2.9); g3 <- c(2.4, 2.0, 2.6, 2.3, 2.7)
a <- c(10.2, 9.8, 11.1, 10.5, 9.9, 10.8, 10.1, 9.6)
b <- c(10.9, 10.1, 11.8, 10.9, 10.2, 11.5, 10.0, 10.3)
tab <- matrix(c(12, 20, 8, 15, 9, 24), nrow = 2, byrow = TRUE)
pooled <- t.test(x, y, var.equal = TRUE)
welch <- t.test(x, y)
av <- summary(aov(v ~ g, data.frame(v = c(g1, g2, g3), g = factor(rep(c("a", "b", "c"), each = 5)))))[[1]]
pt <- t.test(a, b, paired = TRUE)
cs <- chisq.test(tab, correct = FALSE)
G2 <- 2 * sum(tab * log(tab / cs$expected))
pr <- prop.test(c(14, 22), c(40, 45), correct = FALSE)
cat(jsonlite::toJSON(list(
  pooled = list(t = unname(pooled$statistic), df = unname(pooled$parameter), p = pooled$p.value),
  welch = list(t = unname(welch$statistic), df = unname(welch$parameter), p = welch$p.value),
  anova = list(F = av[["F value"]][1], df1 = av$Df[1], df2 = av$Df[2], p = av[["Pr(>F)"]][1]),
  paired = list(t = unname(pt$statistic), df = unname(pt$parameter), p = pt$p.value, est = unname(pt$estimate)),
  chisq = list(X2 = unname(cs$statistic), df = unname(cs$parameter), p = cs$p.value, G2 = G2, pG = pchisq(G2, 2, lower.tail = FALSE)),
  prop = list(chisq = unname(pr$statistic), p = pr$p.value, est = unname(pr$estimate))
), digits = 15, auto_unbox = TRUE))
