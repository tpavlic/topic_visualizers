# Reference values for test/mixed.test.mjs: lme4's Laplace fits (glmer at
# its default nAGQ = 1, lmer by ML and REML) on seeded data with one
# grouping factor: a random intercept, a random intercept and slope, a
# nested factor, an observation-level intercept, glmer.nb, and glmmTMB's beta
# mixed model. Run from anywhere:
#   Rscript glmm_analyzer/test/reference/mixed.R > glmm_analyzer/test/reference/mixed.json
suppressPackageStartupMessages({ library(lme4); library(glmmTMB) })
set.seed(20261014)
m <- 15; k <- 8; n <- m * k
g <- factor(rep(sprintf("g%02d", 1:m), each = k))
h <- factor(paste0(g, "_", rep(c("h1", "h2"), length.out = n)))
x <- round(runif(n, 0, 2), 3)
f <- factor(sample(c("a", "b"), n, replace = TRUE))
bg <- rnorm(m, 0, 0.6)[as.integer(g)]
bs <- rnorm(m, 0, 0.3)[as.integer(g)]
bh <- rnorm(nlevels(h), 0, 0.4)[as.integer(h)]
d <- data.frame(g = g, h = h, x = x, f = f)
d$ycount <- rpois(n, exp(0.3 + 0.5 * x - 0.4 * (f == "b") + bg))
d$ybin <- rbinom(n, 1, plogis(-0.3 + 0.8 * x + bg + bs * x))
d$ynorm <- round(1 + 1.2 * x + 0.5 * (f == "b") + bg + bh + rnorm(n, 0, 0.7), 4)
d$yover <- rpois(n, exp(0.5 + 0.4 * x + rnorm(n, 0, 0.5)))
d$ynb <- rnbinom(n, size = 2, mu = exp(0.4 + 0.5 * x + bg))
mu_b <- plogis(-0.4 + 0.7 * x + bg)
d$ybeta <- pmin(pmax(round(rbeta(n, mu_b * 6, (1 - mu_b) * 6), 5), 1e-4), 1 - 1e-4)
d$obs <- factor(seq_len(n))

vc_list <- function(m) {
  vc <- as.data.frame(VarCorr(m))
  list(grp = vc$grp, var1 = vc$var1, var2 = ifelse(is.na(vc$var2), "", vc$var2), vcov = vc$vcov, sdcor = vc$sdcor)
}
ran <- function(m, which = 1) {
  r <- ranef(m, condVar = TRUE)[[which]]
  cv <- attr(r, "postVar")
  list(levels = rownames(r), modes = unname(as.matrix(r)), condvar = unname(apply(cv, 3, diag)))
}
out_lme4 <- function(m, nd = NULL) {
  s <- summary(m)
  o <- list(fixef = unname(fixef(m)), names = names(fixef(m)), se = unname(s$coefficients[, 2]),
            vc = vc_list(m), loglik = as.numeric(logLik(m)), df = attr(logLik(m), "df"), aic = AIC(m), bic = BIC(m),
            deviance = as.numeric(deviance(m)), theta = unname(getME(m, "theta")), ranef = ran(m),
            fitted = unname(fitted(m)), vcov = unname(as.matrix(vcov(m))))
  if (!is.null(nd)) o$pred_pop <- unname(predict(m, newdata = nd, re.form = NA, type = "response"))
  o
}
nd <- data.frame(x = c(0.5, 1.5), f = factor(c("a", "b"), levels = c("a", "b")))
pois <- glmer(ycount ~ x + f + (1 | g), data = d, family = poisson)
bin <- glmer(ybin ~ x + (1 + x | g), data = d, family = binomial)
lmm_ml <- lmer(ynorm ~ x + f + (1 | g), data = d, REML = FALSE)
lmm_reml <- lmer(ynorm ~ x + f + (1 | g), data = d, REML = TRUE)
nested <- lmer(ynorm ~ x + (1 | g) + (1 | g:h), data = d, REML = FALSE)
olre <- glmer(yover ~ x + (1 | obs), data = d, family = poisson)
olre_g <- glmer(yover ~ x + (1 | g) + (1 | obs), data = d, family = poisson)
nb <- glmer.nb(ynb ~ x + (1 | g), data = d)
tmb <- glmmTMB(ybeta ~ x + (1 | g), data = d, family = beta_family())
# The fixed-effects model, for the test of the random effect.
pois0 <- glm(ycount ~ x + f, data = d, family = poisson)
out <- list(
  data = list(g = as.character(d$g), h = as.character(d$h), x = d$x, f = as.character(d$f), ycount = d$ycount, ybin = d$ybin, ynorm = d$ynorm, yover = d$yover, ynb = d$ynb, ybeta = d$ybeta),
  pois = out_lme4(pois, nd), bin = out_lme4(bin, data.frame(x = c(0.5, 1.5))), lmm_ml = out_lme4(lmm_ml, nd), lmm_reml = out_lme4(lmm_reml, nd),
  nested = c(out_lme4(nested), list(ranef2 = ran(nested, 2))), olre = out_lme4(olre), olre_g = out_lme4(olre_g),
  nb = c(out_lme4(nb), list(theta_nb = getME(nb, "glmer.nb.theta"))),
  tmb = list(fixef = unname(fixef(tmb)$cond), se = unname(sqrt(diag(vcov(tmb)$cond))), loglik = as.numeric(logLik(tmb)), aic = AIC(tmb),
             phi = sigma(tmb), var_g = unname(VarCorr(tmb)$cond$g[1, 1]), ranef = unname(ranef(tmb)$cond$g[, 1])),
  lrt_pois = 2 * (as.numeric(logLik(pois)) - as.numeric(logLik(pois0)))
)
cat(jsonlite::toJSON(out, digits = 15, auto_unbox = TRUE))
