# Reference values for test/ordinal.test.mjs: MASS::polr, the cumulative
# logit (proportional odds) model, on a seeded four-level response. Run from
# anywhere:
#   Rscript glmm_analyzer/test/reference/ordinal.R > glmm_analyzer/test/reference/ordinal.json
set.seed(20261013)
n <- 90
x <- round(runif(n, 0, 3), 3)
f <- factor(sample(c("a", "b"), n, replace = TRUE))
eta <- 0.9 * x - 0.7 * (f == "b")
zeta <- c(0.5, 1.6, 2.6)
u <- runif(n)
cum <- sapply(zeta, function(z) plogis(z - eta))
y <- 1 + (u > cum[, 1]) + (u > cum[, 2]) + (u > cum[, 3])
lev <- c("poor", "fair", "good", "great")
d <- data.frame(y = factor(lev[y], levels = lev, ordered = TRUE), x = x, f = f)
# A tight tolerance, so that the optimum is found to the digits the tests compare.
m <- MASS::polr(y ~ x + f, data = d, Hess = TRUE, control = list(reltol = 1e-14))
s <- summary(m)
nd <- data.frame(x = c(0.5, 2.5), f = factor(c("a", "b"), levels = c("a", "b")))
cat(jsonlite::toJSON(list(
  data = list(y = as.character(d$y), x = d$x, f = as.character(d$f)), levels = lev,
  coef = unname(coef(m)), names = names(coef(m)), zeta = unname(m$zeta), zeta_names = names(m$zeta),
  se = unname(s$coefficients[, 2]), loglik = as.numeric(logLik(m)), df = attr(logLik(m), "df"), aic = AIC(m), bic = BIC(m),
  deviance = m$deviance, fitted = unname(as.matrix(fitted(m))), vcov = unname(vcov(m)),
  pred = unname(as.matrix(predict(m, newdata = nd, type = "probs"))),
  drop = { t <- drop1(m, test = "Chisq"); t <- t[-1, ]; list(terms = rownames(t), df = t$Df, lrt = t$LRT, p = t[["Pr(>Chi)"]]) }
), digits = 15, auto_unbox = TRUE))
