# Reference values for test/negbin.test.mjs: MASS::glm.nb on an overdispersed
# count, with theta and its standard error. Run from anywhere:
#   Rscript glmm_analyzer/test/reference/negbin.R > glmm_analyzer/test/reference/negbin.json
set.seed(20261011)
n <- 80
x <- round(runif(n, 0, 2), 3)
f <- factor(sample(c("p", "q"), n, replace = TRUE))
mu <- exp(0.4 + 0.7 * x + ifelse(f == "q", -0.5, 0))
y <- rnbinom(n, size = 1.8, mu = mu)
d <- data.frame(y = y, x = x, f = f)
m <- MASS::glm.nb(y ~ x + f, data = d)
s <- summary(m)
pm <- glm(y ~ x + f, family = poisson, data = d)
cat(jsonlite::toJSON(list(
  data = as.list(d),
  coef = unname(coef(m)), se = unname(s$coefficients[, 2]), theta = m$theta, se_theta = m$SE.theta,
  deviance = deviance(m), loglik = as.numeric(logLik(m)), df = attr(logLik(m), "df"), aic = AIC(m), bic = BIC(m),
  fitted = unname(fitted(m)), vcov = unname(vcov(m)),
  theta_ml_at_poisson = as.numeric(MASS::theta.ml(y, fitted(pm), limit = 25)),
  digamma = digamma(c(0.3, 1, 2.5, 7, 40)), trigamma = trigamma(c(0.3, 1, 2.5, 7, 40))
), digits = 15, auto_unbox = TRUE))
