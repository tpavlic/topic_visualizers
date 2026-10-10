# Reference values for test/beta.test.mjs: betareg with a logit link for the
# mean and a log link for the precision, on a seeded proportion. Run from
# anywhere:
#   Rscript glmm_analyzer/test/reference/beta.R > glmm_analyzer/test/reference/beta.json
suppressPackageStartupMessages(library(betareg))
set.seed(20261012)
n <- 70
x <- round(runif(n, 0, 2), 3)
f <- factor(sample(c("lo", "hi"), n, replace = TRUE))
mu <- plogis(-0.8 + 0.9 * x + ifelse(f == "lo", 0.5, 0))
phi <- 12
y <- round(rbeta(n, mu * phi, (1 - mu) * phi), 5)
y <- pmin(pmax(y, 1e-4), 1 - 1e-4)
d <- data.frame(y = y, x = x, f = f)
m <- betareg(y ~ x + f, data = d)
s <- summary(m)
mp <- betareg(y ~ x + f, data = d, link = "probit")
nd <- data.frame(x = c(0.3, 1.2), f = factor(c("hi", "lo"), levels = c("hi", "lo")))
cat(jsonlite::toJSON(list(
  data = as.list(d),
  coef = unname(coef(m, model = "mean")), names = names(coef(m, model = "mean")),
  se = unname(s$coefficients$mean[, 2]), phi = unname(coef(m, model = "precision")), se_logphi = unname(s$coefficients$precision[, 2]),
  loglik = as.numeric(logLik(m)), df = attr(logLik(m), "df"), aic = AIC(m), bic = BIC(m),
  fitted = unname(fitted(m)), vcov = unname(vcov(m)), iter = m$optim$count[1],
  pred = unname(predict(m, newdata = nd, type = "response")),
  qres = unname(residuals(m, type = "quantile")),
  probit_coef = unname(coef(mp, model = "mean")), probit_loglik = as.numeric(logLik(mp)), probit_se = unname(summary(mp)$coefficients$mean[, 2])
), digits = 15, auto_unbox = TRUE))
