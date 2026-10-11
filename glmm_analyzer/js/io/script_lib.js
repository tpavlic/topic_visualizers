// The code snippets the regenerate scripts carry, one per language and
// helper: the report helper every script prints through, the fitting
// function that dispatches on the family and the random part to each
// language's own routine, the accessors that read a fit's coefficients and
// statistics in one shape, the term tests, the quantile residuals, the
// reference-grid rows, and the Shapiro–Wilk check. The keys are LIB.R (both
// R dialects), LIB.py, and LIB.m. Every snippet is a template literal, and so
// none may contain a backtick or a dollar sign followed by a brace. Pure text.

export const LIB = { R: {}, py: {}, m: {} };

LIB.R.report = `
# report() prints one result and checks it against the value the GLMM
# Analyzer's page showed (analyzer), within a relative tolerance tol.
report_state <- new.env()
report_start <- function(details) {
  report_state$details <- isTRUE(details)
  report_state$n <- 0
  report_state$bad <- character(0)
}
report_fmt <- function(v, digits = 10) {
  if (length(v) == 0 || (length(v) == 1 && is.na(v))) return("NaN")
  if (is.logical(v)) return(if (isTRUE(v)) "yes" else "no")
  if (is.numeric(v)) return(sprintf(paste0("%.", digits, "g"), as.numeric(v)))
  as.character(v)
}
report_agrees <- function(v, a, tol) {
  if (length(v) == 0) v <- NaN
  if (length(v) != 1) return(FALSE)
  if (is.logical(v) || is.logical(a)) return(isTRUE(as.logical(v) == as.logical(a)))
  if (is.character(v) || is.character(a)) return(identical(as.character(v), as.character(a)))
  v <- as.numeric(v); a <- as.numeric(a)
  if (is.na(v) || is.na(a)) return(is.na(v) && is.na(a))
  if (is.infinite(v) || is.infinite(a)) return(v == a)
  abs(v - a) <= tol * max(1, abs(a))
}
report <- function(name, value, analyzer = NULL, tol = 1e-6) {
  if (report_state$details) {
    cat(sprintf("%s: %s%s\\n", name, report_fmt(value),
                if (is.null(analyzer)) "" else sprintf("   (analyzer: %s)", report_fmt(analyzer))))
  } else {
    cat(sprintf("  %-36s %s\\n", name, report_fmt(value, 7)))
  }
  if (is.null(analyzer)) return(invisible(NULL))
  report_state$n <- report_state$n + 1
  if (!report_agrees(value, analyzer, tol)) {
    report_state$bad <- c(report_state$bad,
      sprintf("%s: %s here, %s on the page", name, report_fmt(value), report_fmt(analyzer)))
  }
  invisible(NULL)
}
report_section <- function(title, tag = NULL) {
  # The section's heading, and under it any tag saying why the section is there.
  if (report_state$details) return(invisible(NULL))
  cat("\\n", title, "\\n", sep = "")
  if (!is.null(tag)) cat(tag, "\\n", sep = "")
  cat(strrep("-", max(nchar(title), nchar(tag))), "\\n", sep = "")
}
report_summary <- function() {
  n <- report_state$n; bad <- report_state$bad
  if (n == 0) return(invisible(NULL))
  if (length(bad) == 0) {
    cat(sprintf("\\nAll %d results agree with the values on the GLMM Analyzer's page.\\n", n))
  } else {
    cat(sprintf("\\n%d of %d results differ from the values on the GLMM Analyzer's page:\\n", length(bad), n))
    cat(paste0("  ", bad, "\\n"), sep = "")
  }
  invisible(NULL)
}
`;

LIB.py.report = `
# report() prints one result and checks it against the value the GLMM
# Analyzer's page showed (analyzer), within a relative tolerance tol.
_report = {"details": False, "n": 0, "bad": []}


def report_start(details):
    _report.update(details=bool(details), n=0, bad=[])


def report_fmt(v, digits=10):
    if v is None:
        return "NaN"
    if isinstance(v, (bool, np.bool_)):
        return "yes" if v else "no"
    if isinstance(v, (int, float, np.integer, np.floating)):
        v = float(v)
        if np.isnan(v):
            return "NaN"
        if np.isinf(v):
            return "Inf" if v > 0 else "-Inf"
        return f"{v:.{digits}g}"
    return str(v)


def report_agrees(v, a, tol):
    if isinstance(v, (bool, np.bool_)) or isinstance(a, (bool, np.bool_)):
        return bool(v) == bool(a)
    if isinstance(v, str) or isinstance(a, str):
        return str(v) == str(a)
    v = np.nan if v is None else float(v)
    a = float(a)
    if np.isnan(v) or np.isnan(a):
        return bool(np.isnan(v) and np.isnan(a))
    if np.isinf(v) or np.isinf(a):
        return v == a
    return abs(v - a) <= tol * max(1.0, abs(a))


def report(name, value, analyzer=None, tol=1e-6):
    if _report["details"]:
        tail = "" if analyzer is None else f"   (analyzer: {report_fmt(analyzer)})"
        print(f"{name}: {report_fmt(value)}{tail}")
    else:
        print(f"  {name:<36} {report_fmt(value, 7)}")
    if analyzer is None:
        return
    _report["n"] += 1
    if not report_agrees(value, analyzer, tol):
        _report["bad"].append(f"{name}: {report_fmt(value)} here, {report_fmt(analyzer)} on the page")


def report_section(title, tag=None):
    # The section's heading, and under it any tag saying why the section is there.
    if _report["details"]:
        return
    print("\\n" + title)
    if tag:
        print(tag)
    print("-" * max(len(title), len(tag or "")))


def report_summary():
    n, bad = _report["n"], _report["bad"]
    if n == 0:
        return
    if not bad:
        print(f"\\nAll {n} results agree with the values on the GLMM Analyzer's page.")
    else:
        print(f"\\n{len(bad)} of {n} results differ from the values on the GLMM Analyzer's page:")
        for line in bad:
            print("  " + line)
`;

LIB.m.report = `
function report_start(details)
% Starts the record of results checked against the GLMM Analyzer's page.
report_store('start', details);
end

function report(name, value, analyzer, tol)
% Prints one result and checks it against the value the GLMM Analyzer's
% page showed (analyzer), within a relative tolerance tol (1e-6 unless given).
if nargin < 4, tol = 1e-6; end
has = nargin >= 3 && ~(isnumeric(analyzer) && isempty(analyzer));
if report_store('details')
    tail = '';
    if has, tail = sprintf('   (analyzer: %s)', report_fmt(analyzer, 10)); end
    fprintf('%s: %s%s\\n', name, report_fmt(value, 10), tail);
else
    fprintf('  %-36s %s\\n', name, report_fmt(value, 7));
end
if has
    report_store('add', report_agrees(value, analyzer, tol), ...
        sprintf('%s: %s here, %s on the page', name, report_fmt(value, 10), report_fmt(analyzer, 10)));
end
end

function report_section(title, tag)
% The section's heading, and under it any tag saying why the section is there.
if report_store('details'), return; end
if nargin < 2, tag = ''; end
fprintf('\\n%s\\n', title);
if ~isempty(tag), fprintf('%s\\n', tag); end
fprintf('%s\\n', repmat('-', 1, max(numel(title), numel(tag))));
end

function report_summary()
[n, bad] = report_store('get');
if n == 0, return; end
if isempty(bad)
    fprintf('\\nAll %d results agree with the values on the GLMM Analyzer''s page.\\n', n);
else
    fprintf('\\n%d of %d results differ from the values on the GLMM Analyzer''s page:\\n', numel(bad), n);
    fprintf('  %s\\n', bad{:});
end
end

function varargout = report_store(op, varargin)
% The record behind report(): whether to print details, and how many results
% were checked and which of them differ. A local function keeps it between calls.
persistent details n bad
if isempty(details), details = false; n = 0; bad = {}; end
switch op
    case 'start', details = logical(varargin{1}); n = 0; bad = {};
    case 'details', varargout{1} = details;
    case 'add', n = n + 1; if ~varargin{1}, bad{end + 1} = varargin{2}; end
    case 'get', varargout{1} = n; varargout{2} = bad;
end
end

function ok = report_agrees(v, a, tol)
if isempty(v), v = NaN; end
if islogical(v) || islogical(a)
    ok = isscalar(v) && logical(v) == logical(a);
elseif ischar(v) || isstring(v) || ischar(a) || isstring(a)
    ok = strcmp(string(v), string(a));
elseif isnan(v) || isnan(a)
    ok = isnan(v) && isnan(a);
elseif isinf(v) || isinf(a)
    ok = v == a;
else
    ok = abs(v - a) <= tol * max(1, abs(a));
end
end

function s = report_fmt(v, digits)
% One value as a report line prints it: a number to the given significant
% digits, yes/no for a logical, NaN for a missing number, and the text itself.
if isempty(v) && ~ischar(v) && ~isstring(v)
    s = 'NaN';
elseif islogical(v)
    s = 'no'; if v, s = 'yes'; end
elseif isnumeric(v)
    s = sprintf(['%.' num2str(digits) 'g'], v);
else
    s = char(v);
end
end
`;

LIB.R.shapiro = `
shapiro_check <- function(name, x, analyzerW = NULL, analyzerP = NULL, tol = 1e-6) {
  if (length(x) < 3 || length(x) > 5000 || min(x) == max(x)) {
    cat(sprintf("%s: too few values, too many, or no spread to test\\n", name)); return(invisible())
  }
  sw <- shapiro.test(x)
  report(paste(name, "W"), unname(sw$statistic), analyzerW, tol)
  report(paste(name, "p"), sw$p.value, analyzerP, tol)
  report_verdict(sw$p.value, alpha)
  invisible(sw)
}
# The check's verdict at alpha, in words, under its W and p.
report_verdict <- function(p, alpha) {
  if (report_state$details || !is.finite(p)) return(invisible())
  cat(if (p < alpha) sprintf("    p < %g: these values do not look normal\\n", alpha)
      else sprintf("    p >= %g: no evidence against normality\\n", alpha))
}
`;

LIB.py.shapiro = `
def shapiro_check(name, x, analyzer_w=None, analyzer_p=None, tol=1e-6):
    x = np.asarray(x, float)
    if len(x) < 3 or len(x) > 5000 or x.min() == x.max():
        print(f"{name}: too few values, too many, or no spread to test"); return
    W, p = stats.shapiro(x)
    report(f"{name} W", W, analyzer_w, tol)
    report(f"{name} p", p, analyzer_p, tol)
    report_verdict(p, alpha)


def report_verdict(p, alpha):
    """The check's verdict at alpha, in words, under its W and p."""
    if _report["details"] or not np.isfinite(p):
        return
    if p < alpha:
        print(f"    p < {alpha:g}: these values do not look normal")
    else:
        print(f"    p >= {alpha:g}: no evidence against normality")
`;

LIB.m.shapiro = `
function shapiro_check(name, x, alpha, analyzerW, analyzerP, tol)
% The Shapiro-Wilk test, if a swtest function is on the path: the toolbox's own
% from R2026b, or the File Exchange function of that name in earlier releases.
x = x(:);
if numel(x) < 3 || numel(x) > 5000 || min(x) == max(x)
    fprintf('%s: too few values, too many, or no spread to test\\n', name); return;
end
if exist('swtest', 'file') == 2
    % The toolbox's swtest takes name-value arguments (its nargin is negative), and the
    % File Exchange's takes alpha as its second argument.
    if nargin('swtest') < 0
        [~, p, W] = swtest(x, 'Alpha', alpha);
    else
        [~, p, W] = swtest(x, alpha);
    end
    if nargin < 6, tol = 1e-6; end
    if nargin < 4, report([name ' W'], W); else, report([name ' W'], W, analyzerW, tol); end
    if nargin < 5, report([name ' p'], p); else, report([name ' p'], p, analyzerP, tol); end
    % The check's verdict at alpha, in words, under its W and p.
    if ~report_store('details') && isfinite(p)
        if p < alpha
            fprintf('    p < %g: these values do not look normal\\n', alpha);
        else
            fprintf('    p >= %g: no evidence against normality\\n', alpha);
        end
    end
else
    fprintf('%s: no Shapiro-Wilk function on the path (swtest, in the toolbox from R2026b, would run here)\\n', name);
end
end
`;

LIB.m.studrange = `
function p = studrange_cdf(q, k, nu)
if q <= 0, p = 0; return; end
if ~isfinite(nu)
    p = min(1, k * integral(@(x) normpdf(x) .* (normcdf(x + q) - normcdf(x)).^(k - 1), -8, 8, 'RelTol', 1e-10, 'AbsTol', 1e-13));
    return;
end
dens = @(s) exp(log(2) + (nu / 2) * log(nu / 2) + (nu - 1) .* log(s) - nu .* s.^2 / 2 - gammaln(nu / 2));
inner = @(s) k * integral(@(x) normpdf(x) .* (normcdf(x + q * s) - normcdf(x)).^(k - 1), -8, 8, 'RelTol', 1e-10, 'AbsTol', 1e-13);
p = integral(@(s) dens(s) .* arrayfun(inner, s), 0, Inf, 'RelTol', 1e-10, 'AbsTol', 1e-13);
p = min(1, p);
end

function q = studrange_inv(p, k, nu)
% The bracket's upper end doubles until it holds the quantile, which grows fast on few degrees of freedom.
hi = 50;
while studrange_cdf(hi, k, nu) < p, hi = 2 * hi; end
q = fzero(@(q) studrange_cdf(q, k, nu) - p, [0.05 hi], optimset('TolX', 1e-10));
end
`;

// ── The fit ──────────────────────────────────────────────────────────────
// fit_model(d, family, link, formula, reml) fits the model with the
// language's own routine. The accessors give one shape in every language:
// fit_names (the coefficient names as the page prints them come from the
// script's own list), fit_coef, fit_se, fit_loglik, fit_k (the parameter
// count), fit_deviance, fit_nulldev, fit_dispersion, fit_aux (theta or phi),
// fit_fitted (conditional on the group effects), fit_vcov (of the fixed
// effects), fit_thresholds, fit_varcomp (a table of the random effects'
// variances), and fit_refit(formula) for the term tests.

LIB.R.fit = `
fit_model <- function(d, family, link, formula, reml = FALSE) {
  f <- as.formula(formula)
  mixed <- grepl("|", formula, fixed = TRUE)
  if (family == "ordinal") return(MASS::polr(f, data = d, Hess = TRUE, control = list(reltol = 1e-14)))
  if (mixed) {
    if (family == "normal") return(lme4::lmer(f, data = d, REML = reml, control = lme4::lmerControl(check.conv.singular = "ignore")))
    if (family == "negbin") return(suppressMessages(lme4::glmer.nb(f, data = d, control = lme4::glmerControl(check.conv.singular = "ignore"))))
    if (family == "beta") return(glmmTMB::glmmTMB(f, data = d, family = glmmTMB::beta_family(link = link)))
    fam <- switch(family, binomial = binomial(link), poisson = poisson(link), gamma = Gamma(link = link))
    return(lme4::glmer(f, data = d, family = fam, control = lme4::glmerControl(check.conv.singular = "ignore")))
  }
  if (family == "negbin") return(MASS::glm.nb(f, data = d, control = glm.control(maxit = 100)))
  if (family == "beta") return(betareg::betareg(f, data = d, link = link))
  fam <- switch(family, normal = gaussian(link), binomial = binomial(link), poisson = poisson(link), gamma = Gamma(link = link))
  # Tighter than glm.control's default, which can stop a few parts in 1e-5 short on a non-canonical link.
  glm(f, data = d, family = fam, control = glm.control(epsilon = 1e-12, maxit = 100))
}
fit_class <- function(m) {
  if (inherits(m, "glmmTMB")) "tmb" else if (inherits(m, "merMod")) "lme4" else if (inherits(m, "polr")) "polr"
  else if (inherits(m, "betareg")) "betareg" else if (inherits(m, "negbin")) "negbin" else "glm"
}
fit_coef <- function(m) {
  switch(fit_class(m), tmb = unname(glmmTMB::fixef(m)$cond), lme4 = unname(lme4::fixef(m)),
         betareg = unname(coef(m, model = "mean")), unname(coef(m)))
}
fit_vcov <- function(m) {
  v <- switch(fit_class(m), tmb = vcov(m)$cond, betareg = vcov(m, model = "mean"), lme4 = as.matrix(vcov(m)), vcov(m))
  p <- length(fit_coef(m))
  unname(as.matrix(v))[seq_len(p), seq_len(p), drop = FALSE]
}
fit_se <- function(m) sqrt(diag(fit_vcov(m)))
# The covariance of the coefficients in the given order of names.
vcov_at <- function(m, names) { V <- fit_vcov(m); have <- names(fit_coef_named(m)); V[match(names, have), match(names, have), drop = FALSE] }
fit_coef_named <- function(m) switch(fit_class(m), tmb = glmmTMB::fixef(m)$cond, lme4 = lme4::fixef(m), betareg = coef(m, model = "mean"), coef(m))
fit_loglik <- function(m) as.numeric(logLik(m))
fit_k <- function(m) as.integer(attr(logLik(m), "df"))
fit_deviance <- function(m) switch(fit_class(m), lme4 = as.numeric(-2 * logLik(m)), tmb = as.numeric(-2 * logLik(m)), polr = m$deviance, betareg = NaN, deviance(m))
fit_nulldev <- function(m) if (fit_class(m) %in% c("glm", "negbin")) m$null.deviance else NaN
# A gamma glmer's dispersion is lme4's: the penalized weighted residual sum of squares over n.
fit_dispersion <- function(m) switch(fit_class(m), glm = summary(m)$dispersion, lme4 = if (lme4::isLMM(m) || family(m)$family == "Gamma") sigma(m)^2 else 1, 1)
fit_aux <- function(m) switch(fit_class(m), negbin = m$theta, betareg = unname(coef(m, model = "precision")), tmb = glmmTMB::sigma(m),
                              lme4 = if (!is.null(lme4::getME(m, "glmer.nb.theta"))) lme4::getME(m, "glmer.nb.theta") else NA, NA)
fit_fitted <- function(m) switch(fit_class(m), polr = NaN, unname(fitted(m)))
fit_thresholds <- function(m) if (fit_class(m) == "polr") unname(m$zeta) else numeric(0)
fit_varcomp <- function(m) {
  # One row per variance: the group, the effect, the variance, and the slope's correlation.
  if (fit_class(m) == "lme4") {
    vc <- as.data.frame(lme4::VarCorr(m))
    return(data.frame(grp = vc$grp, var1 = ifelse(is.na(vc$var1), "", vc$var1), var2 = ifelse(is.na(vc$var2), "", vc$var2), value = vc$vcov, sdcor = vc$sdcor, stringsAsFactors = FALSE))
  }
  if (fit_class(m) == "tmb") {
    vc <- glmmTMB::VarCorr(m)$cond
    return(data.frame(grp = names(vc), var1 = "(Intercept)", var2 = "", value = sapply(vc, function(v) v[1, 1]), sdcor = sapply(vc, function(v) sqrt(v[1, 1])), stringsAsFactors = FALSE))
  }
  data.frame(grp = character(0), var1 = character(0), var2 = character(0), value = numeric(0), sdcor = numeric(0))
}
# The variance of one random effect (term and effect name, "slope" for the slope), or NaN.
varcomp_at <- function(vc, term, effect) {
  r <- vc[vc$grp == term & vc$var2 == "" & (if (effect == "(Intercept)") vc$var1 == "(Intercept)" else vc$var1 != "(Intercept)"), ]
  if (nrow(r) == 0) NaN else r$value[1]
}
varcomp_corr <- function(vc, term) { r <- vc[vc$grp == term & vc$var2 != "", ]; if (nrow(r) == 0) NaN else r$sdcor[1] }
# The log-likelihood of the model refitted by maximum likelihood (a REML fit is refitted).
fit_ml <- function(m, d, family, link, formula) if (fit_class(m) == "lme4" && lme4::isREML(m)) fit_model(d, family, link, formula, FALSE) else m
# The model without a term, refitted by maximum likelihood; a negative binomial holds the
# full model's theta, as drop1 holds the family fixed.
fit_reduced <- function(full, d, family, link, formula) {
  if (fit_class(full) == "negbin") return(glm(as.formula(formula), family = MASS::negative.binomial(full$theta), data = d, control = glm.control(epsilon = 1e-12, maxit = 100)))
  fit_model(d, family, link, formula, FALSE)
}
# The likelihood-ratio statistic of a term, as drop1(test = "Chisq") forms it.
lrt_stat <- function(full, red, family) {
  cls <- fit_class(full)
  if (cls %in% c("glm", "negbin")) {
    if (family == "normal") return(nobs(full) * log(deviance(red) / deviance(full)))
    if (family == "gamma") return((deviance(red) - deviance(full)) / summary(full)$dispersion)
    return(deviance(red) - deviance(full))
  }
  2 * (fit_loglik(full) - fit_loglik(red))
}
`;

LIB.R.variance = `
# The variance decomposition: the variance of the fixed-effect linear predictor, each random
# term's variance averaged over the rows (an observation-level effect's counted as dispersion),
# and the distribution-specific variance on the link scale, as insight::get_variance forms them
# for a mixed model, with performance's r2_nakagawa and icc; a model with no random part gets
# the same pieces written out here, where those packages decline.
fixed_predictor <- function(m) switch(fit_class(m), lme4 = predict(m, re.form = NA), tmb = predict(m, re.form = NA), betareg = predict(m, type = "link"), predict(m, type = "link"))
null_formula <- function(formula) {
  # The intercept-only model with the same random part.
  resp <- sub("~.*$", "", formula)
  bars <- regmatches(formula, gregexpr("\\\\([^()]*\\\\|[^()]*\\\\)", formula))[[1]]
  paste(resp, "~ 1", if (length(bars)) paste("+", paste(bars, collapse = " + ")) else "")
}
pick <- function(x, nm) { if (!is.list(x)) return(NA); out <- x[[nm]]; if (is.null(out) || length(out) == 0) NA else unname(out) }
# The distribution-specific variance by hand: at the mean the intercept-only model implies.
distribution_variance <- function(m, null, family, link, random_null) {
  b0 <- unname(fit_coef(null)[1])
  switch(family,
    normal = fit_dispersion(m),
    binomial = switch(link, logit = pi^2 / 3, probit = 1, cloglog = pi^2 / 6, NaN),
    poisson = log1p(1 / exp(b0 + 0.5 * random_null)),
    negbin = log1p(1 / exp(b0 + 0.5 * random_null) + 1 / fit_aux(m)),
    gamma = log1p(fit_dispersion(m)),
    beta = { mu <- plogis(b0); log1p((mu * (1 - mu) / (1 + fit_aux(m))) / mu^2) },
    NaN)
}
variance_parts <- function(m, d, family, link, formula) {
  vf <- var(as.vector(fixed_predictor(m)))
  mixed <- fit_class(m) %in% c("lme4", "tmb")
  # The intercept-only model with the same random part, fitted here and handed to insight and
  # performance: their own refit of it cannot see fit_model's local variables.
  null <- fit_model(d, family, link, null_formula(formula), FALSE)
  vr <- 0; vo <- 0; vd <- NA; r2m <- NA; r2c <- NA; ic <- NA
  if (mixed) {
    v <- suppressWarnings(insight::get_variance(m, null_model = null))
    if (is.list(v)) {
      vr <- pick(v, "var.random"); if (is.na(vr)) vr <- 0
      vo <- pick(v, "var.dispersion"); if (is.na(vo)) vo <- 0
      vd <- pick(v, "var.distribution")
      r2 <- suppressWarnings(performance::r2_nakagawa(m, null_model = null))
      r2m <- pick(r2, "R2_marginal"); r2c <- pick(r2, "R2_conditional")
      ic <- pick(suppressWarnings(performance::icc(m, null_model = null)), "ICC_adjusted")
    } else {
      # insight declines a model whose only random term is the observation level; its
      # variance is read from the fit, and the pieces are formed below.
      vc <- fit_varcomp(m)
      ints <- vc$var2 == "" & vc$var1 == "(Intercept)"
      vo <- sum(vc$value[ints & vc$grp == "obs"])
      vr <- sum(vc$value[ints & vc$grp != "obs"])
    }
  }
  if (is.na(vd)) {
    random_null <- if (mixed) { rn <- pick(suppressWarnings(insight::get_variance(null, null_model = null)), "var.random"); if (is.na(rn)) 0 else rn } else 0
    vd <- distribution_variance(m, null, family, link, random_null)
  }
  tot <- vf + vr + vo + vd
  if (is.na(r2m)) r2m <- vf / tot
  if (is.na(r2c)) r2c <- (vf + vr) / tot
  list(fixed = vf, random = vr, dispersion = vo, distribution = vd, total = tot, r2m = r2m, r2c = r2c, icc = ic)
}
`;

LIB.R.grid = `
# The design rows of new data, with the columns the page's coefficients name: the fixed part
# of the fitted formula applied to the new rows, whose factors carry the data's levels.
grid_rows <- function(m, d, newdata, names) {
  f <- formula(m)
  if (fit_class(m) %in% c("lme4", "tmb")) f <- if (requireNamespace("reformulas", quietly = TRUE)) reformulas::nobars(f) else lme4::nobars(f)
  if (fit_class(m) == "betareg") f <- as.formula(paste(deparse(f[[2]]), "~", deparse(f[[3]])))
  tt <- delete.response(terms(f))
  # The data's factor levels for the columns the new rows carry (model.frame warns of a
  # level set for a column the rows lack, such as a grouping factor).
  xlev <- lapply(d[sapply(d, is.factor)], levels)
  xlev <- xlev[intersect(names(xlev), names(newdata))]
  for (v in names(xlev)) newdata[[v]] <- factor(newdata[[v]], levels = xlev[[v]])
  mf <- model.frame(tt, newdata, xlev = xlev)
  X <- model.matrix(tt, mf)
  X[, names, drop = FALSE]
}
# The mean on the response scale from the linear predictor.
linkinv_of <- function(m, eta) {
  cls <- fit_class(m)
  if (cls == "polr") return(eta)
  lk <- if (cls == "betareg") m$link$mean else if (cls == "tmb") glmmTMB::family(m)$linkinv else family(m)$linkinv
  if (is.function(lk)) lk(eta) else lk$linkinv(eta)
}
`;

LIB.R.qresid = `
# Randomized quantile residuals: the fitted distribution function at each response, randomized
# within the probability of a discrete value with the given uniforms, on the normal scale.
quantile_residuals <- function(y, mu, family, aux, u) {
  lo <- switch(family,
    normal = pnorm(y, mu, sqrt(aux)), gamma = pgamma(y, shape = 1 / aux, scale = mu * aux), beta = pbeta(y, mu * aux, (1 - mu) * aux),
    binomial = ifelse(y > 0.5, 1 - mu, 0), poisson = ppois(y - 1, mu), negbin = pnbinom(y - 1, size = aux, mu = mu))
  hi <- switch(family,
    normal = lo, gamma = lo, beta = lo,
    binomial = ifelse(y > 0.5, 1, 1 - mu), poisson = ppois(y, mu), negbin = pnbinom(y, size = aux, mu = mu))
  p <- if (family %in% c("binomial", "poisson", "negbin")) lo + u * (hi - lo) else lo
  qnorm(pmin(1 - .Machine$double.eps, pmax(.Machine$double.eps, p)))
}
`;

LIB.py.fit = `
def fit_model(d, family, link, formula, reml=False, group=None, re_formula=None):
    """The model by statsmodels: GLM for the exponential families, NegativeBinomial, BetaModel,
    OrderedModel, and MixedLM for the normal family's mixed model."""
    import statsmodels.api as sm
    import statsmodels.formula.api as smf
    links = {"identity": sm.families.links.Identity, "log": sm.families.links.Log, "logit": sm.families.links.Logit,
             "probit": sm.families.links.Probit, "cloglog": sm.families.links.CLogLog, "inverse": sm.families.links.InversePower,
             "sqrt": sm.families.links.Sqrt}
    if group is not None:
        m = smf.mixedlm(formula, d, groups=d[group], re_formula=re_formula)
        return m.fit(reml=reml, method=["lbfgs", "bfgs"], maxiter=500)
    if family == "ordinal":
        from statsmodels.miscmodels.ordinal_model import OrderedModel
        from patsy import dmatrix
        lhs, rhs = formula.split("~", 1)
        X = dmatrix(rhs, d, return_type="dataframe").drop(columns="Intercept")
        yname = lhs.strip().replace('Q("', "").replace('")', "")
        m = OrderedModel(d[yname], X, distr="logit")
        r = m.fit(method="bfgs", disp=0, maxiter=1000, gtol=1e-10)
        r.ordinal_names = list(X.columns)
        return r
    if family == "negbin":
        # theta from the discrete model's joint fit, then the GLM at that theta, whose
        # coefficients, standard errors, and deviance are what glm.nb reports.
        nb = smf.negativebinomial(formula, d).fit(disp=0, maxiter=500, tol=1e-10)
        theta = 1.0 / float(np.asarray(nb.params)[-1])
        g = smf.glm(formula, d, family=sm.families.NegativeBinomial(alpha=1.0 / theta)).fit(tol=1e-12, maxiter=200)
        g.nb_theta = theta
        return g
    if family == "beta":
        from statsmodels.othermod.betareg import BetaModel
        m = BetaModel.from_formula(formula, d, link=links[link]())
        r = m.fit(disp=0, maxiter=500, gtol=1e-10)
        r.beta_cov = beta_expected_cov(r)
        return r
    fam = {"normal": sm.families.Gaussian, "binomial": sm.families.Binomial, "poisson": sm.families.Poisson, "gamma": sm.families.Gamma}[family]
    return smf.glm(formula, d, family=fam(link=links[link]())).fit(tol=1e-12, maxiter=200)


def beta_expected_cov(r):
    """The covariance of a beta regression's mean coefficients from the expected
    information (Ferrari and Cribari-Neto), which betareg reports; statsmodels'
    own is the observed one."""
    from scipy.special import polygamma
    X = np.asarray(r.model.exog, float)
    p = X.shape[1]
    eta = X @ np.asarray(r.params)[:p]
    mu = np.asarray(r.model.link.inverse(eta), float)
    phi = float(np.exp(np.asarray(r.params)[-1]))
    me = np.asarray(r.model.link.inverse_deriv(eta), float)
    a = mu * phi; b = (1 - mu) * phi
    ta = polygamma(1, a); tb = polygamma(1, b)
    w = phi * (ta + tb) * me ** 2
    c = phi * (ta * mu - tb * (1 - mu))
    dsum = float(np.sum(ta * mu ** 2 + tb * (1 - mu) ** 2 - polygamma(1, phi)))
    K = np.zeros((p + 1, p + 1))
    K[:p, :p] = phi * (X * w[:, None]).T @ X
    K[:p, p] = (X * (me * c)[:, None]).sum(axis=0)
    K[p, :p] = K[:p, p]
    K[p, p] = dsum
    V = np.linalg.inv(K)
    return V[:p, :p]


def fit_class(m):
    name = type(m).__name__
    if "MixedLM" in name:
        return "mixedlm"
    if "Ordered" in name or "OrderedModel" in type(m.model).__name__:
        return "ordinal"
    if getattr(m, "nb_theta", None) is not None:
        return "negbin"
    if "BetaModel" in type(m.model).__name__:
        return "beta"
    return "glm"


def fit_p(m):
    """The number of fixed-effect coefficients, the intercept included."""
    cls = fit_class(m)
    if cls == "mixedlm":
        return len(m.fe_params)
    if cls == "ordinal":
        return len(m.params) - (m.model.k_levels - 1)
    if cls == "beta":
        return m.model.exog.shape[1]
    return len(m.params)


def fit_coef(m):
    p = fit_p(m)
    return np.asarray(m.fe_params if fit_class(m) == "mixedlm" else m.params[:p], float)


def fit_vcov(m):
    p = fit_p(m)
    if fit_class(m) == "beta":
        return np.asarray(m.beta_cov)
    if fit_class(m) == "mixedlm":
        # The covariance of the fixed effects as lme4 reports it: the profiled form
        # (X' V^-1 X)^-1 with V the marginal covariance of each group's rows at the
        # fitted variance parameters. statsmodels takes it from the observed Hessian over
        # every parameter, whose cross terms with the variance parameters move the
        # standard errors by a few percent in small samples.
        G = np.atleast_2d(np.asarray(m.cov_re, float))
        s2 = float(m.scale)
        K = np.zeros((p, p))
        for X, Z in zip(m.model.exog_li, m.model.exog_re_li):
            X = np.asarray(X, float)
            Z = np.atleast_2d(np.asarray(Z, float))
            if Z.shape[0] != X.shape[0]:
                Z = Z.T
            V = s2 * np.eye(X.shape[0]) + Z @ G @ Z.T
            K += X.T @ np.linalg.solve(V, X)
        return np.linalg.inv(K)
    v = m.cov_params()
    return np.asarray(v)[:p, :p]


def fit_se(m):
    return np.sqrt(np.diag(fit_vcov(m)))


def fit_k(m):
    cls = fit_class(m)
    if cls == "mixedlm":
        return fit_p(m) + m.k_re * (m.k_re + 1) // 2 + m.k_vc + 1
    if cls == "negbin":
        return len(m.params) + 1
    if cls in ("glm",) and m.model.family.__class__.__name__ in ("Gaussian", "Gamma"):
        return len(m.params) + 1
    return len(m.params)


def fit_deviance(m):
    cls = fit_class(m)
    if cls in ("glm", "negbin"):
        return float(m.deviance)
    if cls == "ordinal":
        return -2.0 * m.llf
    if cls == "mixedlm":
        return -2.0 * m.llf
    return np.nan


def fit_nulldev(m):
    return float(m.null_deviance) if fit_class(m) in ("glm", "negbin") else np.nan


def fit_dispersion(m):
    cls = fit_class(m)
    if cls == "glm":
        return float(m.scale)
    if cls == "mixedlm":
        return float(m.scale)
    return 1.0


def fit_aux(m):
    cls = fit_class(m)
    if cls == "negbin":
        return float(m.nb_theta)
    if cls == "beta":
        return float(np.exp(np.asarray(m.params)[-1]))
    return np.nan


def fit_fitted(m):
    cls = fit_class(m)
    if cls == "mixedlm":
        return np.asarray(m.fittedvalues, float)
    if cls == "ordinal":
        return np.full(len(m.model.endog), np.nan)
    if cls == "beta":
        return np.asarray(m.predict(), float)
    return np.asarray(m.fittedvalues if cls in ("glm", "negbin") else m.predict(), float)


def fit_thresholds(m):
    if fit_class(m) != "ordinal":
        return np.array([])
    p = fit_p(m)
    return np.asarray(m.model.transform_threshold_params(np.asarray(m.params))[1:-1], float)


def lrt_stat(full, red, family):
    """The likelihood-ratio statistic of a term, as R's drop1(test = "Chisq") forms it."""
    cls = fit_class(full)
    if cls == "glm":
        if family == "normal":
            return float(full.nobs) * np.log(red.deviance / full.deviance)
        if family == "gamma":
            return (red.deviance - full.deviance) / full.scale
        return float(red.deviance - full.deviance)
    if cls == "negbin":
        return float(red.deviance - full.deviance)
    return 2.0 * (full.llf - red.llf)


def fit_reduced(full, d, family, link, formula, group=None, re_formula=None):
    """The model without a term, refitted by maximum likelihood; a negative binomial holds the
    full model's theta, as R's drop1 holds the family fixed."""
    if fit_class(full) == "negbin":
        import statsmodels.api as sm
        import statsmodels.formula.api as smf
        return smf.glm(formula, d, family=sm.families.NegativeBinomial(alpha=1.0 / fit_aux(full))).fit(tol=1e-12, maxiter=200)
    return fit_model(d, family, link, formula, False, group=group, re_formula=re_formula)


def fit_coef_names(m):
    cls = fit_class(m)
    if cls == "mixedlm":
        return list(m.fe_params.index)
    if cls == "ordinal":
        return list(m.ordinal_names)
    return list(m.params.index)[:fit_p(m)]


def coef_at(m, name):
    return float(fit_coef(m)[fit_coef_names(m).index(name)])


def vcov_at(m, names):
    """The covariance of the coefficients in the given order of names."""
    have = fit_coef_names(m)
    idx = [have.index(nm) for nm in names]
    V = fit_vcov(m)
    return V[np.ix_(idx, idx)]


def se_at(m, name):
    return float(fit_se(m)[fit_coef_names(m).index(name)])


def fit_ml(m, d, family, link, formula, group=None, re_formula=None):
    """The model refitted by maximum likelihood (a REML mixed model is refitted)."""
    if fit_class(m) == "mixedlm" and m.reml:
        return fit_model(d, family, link, formula, False, group=group, re_formula=re_formula)
    return m


def cooks_max(m, d, family, link, formula):
    """The largest Cook's distance, from the Pearson residuals, the hat values, and the
    dispersion, as R's cooks.distance forms it; a negative binomial is refitted as a GLM at
    its theta for the hat values."""
    import statsmodels.api as sm
    import statsmodels.formula.api as smf
    g = m
    if fit_class(m) == "negbin":
        g = smf.glm(formula, d, family=sm.families.NegativeBinomial(alpha=1.0 / fit_aux(m))).fit(tol=1e-12, maxiter=200)
    X = np.asarray(g.model.exog, float)
    mu = np.asarray(g.fittedvalues, float)
    eta = np.asarray(g.model.family.link(mu), float)
    me = np.asarray(g.model.family.link.inverse_deriv(eta), float)
    w = me ** 2 / np.asarray(g.model.family.variance(mu), float)
    Xw = X * np.sqrt(w)[:, None]
    h = np.einsum("ij,ij->i", Xw @ np.linalg.inv(Xw.T @ Xw), Xw)
    pr = np.asarray(g.resid_pearson, float)
    p = X.shape[1]
    scale = float(g.scale) if fit_class(m) != "negbin" else 1.0
    return float(np.max((pr / (1 - h)) ** 2 * h / (scale * p)))


def fit_loglik(m):
    """The log-likelihood as R reports it: statsmodels' llf for the Gaussian and gamma GLMs uses
    the Pearson dispersion, where R's uses the maximum-likelihood one (deviance / n)."""
    cls = fit_class(m)
    if cls in ("glm", "negbin"):
        fam = m.model.family.__class__.__name__
        y = np.asarray(m.model.endog, float); mu = np.asarray(m.fittedvalues, float); n = y.size
        if fam == "Gaussian":
            return float(-0.5 * n * (np.log(2 * np.pi * m.deviance / n) + 1))
        if fam == "Gamma":
            disp = m.deviance / n
            return float(np.sum(stats.gamma.logpdf(y, 1.0 / disp, scale=mu * disp)))
    return float(m.llf)


def pearson_residuals(m):
    cls = fit_class(m)
    if cls == "glm":
        return np.asarray(m.resid_pearson, float)
    y = np.asarray(m.model.endog, float)
    mu = fit_fitted(m)
    return (y - mu) / np.sqrt(mu)


def fit_varcomp(m):
    """The random effects' variances of a MixedLM fit, keyed as R's VarCorr names them."""
    out = {}
    if fit_class(m) != "mixedlm":
        return out
    cov = np.asarray(m.cov_re, float)
    names = list(m.cov_re.index)
    grp = m.model.groups_name if hasattr(m.model, "groups_name") else "group"
    for i, nm in enumerate(names):
        key = "(Intercept)" if nm in ("Group", "Intercept", "group") else "slope"
        out[(grp, key)] = float(cov[i, i])
    if len(names) == 2:
        out[(grp, "corr")] = float(cov[0, 1] / np.sqrt(cov[0, 0] * cov[1, 1]))
    return out


def varcomp_at(vc, term, effect):
    for (g, k), v in vc.items():
        if k == effect and (g == term or True):
            return v
    return np.nan


def varcomp_corr(vc, term):
    for (g, k), v in vc.items():
        if k == "corr":
            return v
    return np.nan
`;

LIB.py.grid = `
def grid_rows(m, d, newdata, names):
    """The design rows of new data: the formula's right-hand side applied to the new rows,
    whose factors carry the data's levels, in the columns the coefficient names give."""
    from patsy import dmatrix
    X = dmatrix(formula.split("~", 1)[1], newdata, return_type="dataframe")
    return np.asarray(X[names], float)


def linkinv_of(m, eta):
    cls = fit_class(m)
    if cls == "mixedlm":
        return eta
    if cls == "ordinal":
        return eta
    if cls == "beta":
        return m.model.link.inverse(eta)
    if cls == "negbin":
        return np.exp(eta)
    return m.model.family.link.inverse(eta)


def studentized_range_ppf(p, k, df):
    return stats.studentized_range.ppf(p, k, df if np.isfinite(df) else 1e7)


def studentized_range_sf(q, k, df):
    return stats.studentized_range.sf(q, k, df if np.isfinite(df) else 1e7)
`;

LIB.py.qresid = `
def quantile_residuals(y, mu, family, aux, u):
    """Randomized quantile residuals on the normal scale (Dunn and Smyth)."""
    y = np.asarray(y, float); mu = np.asarray(mu, float); u = np.asarray(u, float)
    if family == "normal":
        p = stats.norm.cdf(y, mu, np.sqrt(aux))
    elif family == "gamma":
        p = stats.gamma.cdf(y, 1.0 / aux, scale=mu * aux)
    elif family == "beta":
        p = stats.beta.cdf(y, mu * aux, (1 - mu) * aux)
    else:
        if family == "binomial":
            lo = np.where(y > 0.5, 1 - mu, 0.0); hi = np.where(y > 0.5, 1.0, 1 - mu)
        elif family == "poisson":
            lo = stats.poisson.cdf(y - 1, mu); hi = stats.poisson.cdf(y, mu)
        else:
            pr = aux / (aux + mu)
            lo = stats.nbinom.cdf(y - 1, aux, pr); hi = stats.nbinom.cdf(y, aux, pr)
        p = lo + u * (hi - lo)
    eps = np.finfo(float).eps
    return stats.norm.ppf(np.clip(p, eps, 1 - eps))
`;

LIB.m.fit = `
function m = fit_model(tbl, family, link, formula, reml)
% The model by the Statistics and Machine Learning Toolbox: fitglm for the
% exponential families, fitlme and fitglme for the mixed models, and mnrfit
% for the ordinal model (returned as a struct).
mixed = contains(formula, '|');
dist = family; if strcmp(family, 'normal'), dist = 'normal'; end
lnk = link;
if strcmp(link, 'cloglog'), lnk = 'comploglog'; end
if strcmp(link, 'inverse'), lnk = 'reciprocal'; end
if strcmp(link, 'sqrt'), lnk = 0.5; end
if strcmp(family, 'ordinal')
    m = fit_ordinal(tbl, formula);
    return;
end
if mixed
    if strcmp(family, 'normal')
        if reml, fm = 'REML'; else, fm = 'ML'; end
        m = fitlme(tbl, formula, 'FitMethod', fm);
    else
        m = fitglme(tbl, formula, 'Distribution', dist, 'Link', lnk, 'FitMethod', 'Laplace');
    end
    return;
end
m = fitglm(tbl, formula, 'Distribution', dist, 'Link', lnk);
end

function m = fit_ordinal(tbl, formula)
% The proportional-odds model by mnrfit on the design built from the formula's terms, with
% dummy coding against the first level. mnrfit's thresholds and coefficients are signed for
% P(Y <= k) = logit^-1(theta_k + x'b), and so b here is the negative of polr's.
rhs = strtrim(extractAfter(formula, '~'));
resp = strtrim(extractBefore(formula, '~'));
terms = strtrim(strsplit(rhs, '+'));
X = []; names = {};
for i = 1:numel(terms)
    [cols, nm] = term_columns(tbl, terms{i});
    X = [X cols]; names = [names nm];
end
y = double(tbl.(resp));
[B, ~, st] = mnrfit(X, y, 'model', 'ordinal');
K = max(y);
m = struct('ordinal', true, 'names', {names}, 'B', B, 'stats', st, 'K', K, 'X', X, 'y', y, 'n', numel(y));
m.coef = -B(K:end);
m.zeta = B(1:K-1);
m.loglik = ordinal_loglik(m);
m.vcov = ordinal_vcov(m);
end

function V = ordinal_vcov(m)
% The inverse of the observed information in (b, zeta), as polr reports it.
p = numel(m.coef); q = m.K - 1; H = zeros(p + q);
F = @(t) 1 ./ (1 + exp(-t));
eta = m.X * m.coef;
for i = 1:m.n
    k = m.y(i); x = m.X(i, :)';
    hasA = k < q + 1 && k <= q; hasB = k > 1;
    if k <= q, A = m.zeta(k) - eta(i); FA = F(A); fA = FA * (1 - FA); fpA = fA * (1 - 2 * FA); else, FA = 1; fA = 0; fpA = 0; end
    if k > 1, B = m.zeta(k - 1) - eta(i); FB = F(B); fB = FB * (1 - FB); fpB = fB * (1 - 2 * FB); else, FB = 0; fB = 0; fpB = 0; end
    P = FA - FB;
    idx = 1:p; dP = (fB - fA) * x';
    if k <= q, idx = [idx, p + k]; dP = [dP, fA]; end
    if k > 1, idx = [idx, p + k - 1]; dP = [dP, -fB]; end
    mm = numel(idx);
    S = zeros(mm);
    for r = 1:mm
        for c = 1:mm
            ir = idx(r); ic = idx(c);
            if ir <= p && ic <= p, S(r, c) = (fpA - fpB) * x(ir) * x(ic);
            elseif ir <= p, if ic == p + k && k <= q, S(r, c) = -fpA * x(ir); else, S(r, c) = fpB * x(ir); end
            elseif ic <= p, if ir == p + k && k <= q, S(r, c) = -fpA * x(ic); else, S(r, c) = fpB * x(ic); end
            elseif ir == ic, if ir == p + k && k <= q, S(r, c) = fpA; else, S(r, c) = -fpB; end
            end
        end
    end
    H(idx, idx) = H(idx, idx) + S / P - (dP' * dP) / P^2;
end
V = inv(-H);
end

function ll = ordinal_loglik(m)
eta = m.X * m.coef;
ll = 0;
for i = 1:m.n
    k = m.y(i);
    A = 1; B = 0;
    if k < m.K, A = 1 / (1 + exp(-(m.zeta(k) - eta(i)))); end
    if k > 1, B = 1 / (1 + exp(-(m.zeta(k - 1) - eta(i)))); end
    ll = ll + log(A - B);
end
end

function [cols, names] = term_columns(tbl, term)
% The design columns of one term: a continuous variable as itself, a categorical variable as
% dummies against its first level, and an interaction as the products, the first factor's
% columns varying fastest.
parts = strtrim(strsplit(term, ':'));
cols = ones(height(tbl), 1); names = {''};
for p = 1:numel(parts)
    v = tbl.(parts{p});
    if iscategorical(v)
        lv = categories(v);
        c = zeros(height(tbl), numel(lv) - 1); nm = cell(1, numel(lv) - 1);
        for k = 2:numel(lv), c(:, k - 1) = double(v == lv{k}); nm{k - 1} = [parts{p} '_' lv{k}]; end
    else
        c = double(v); nm = parts(p);
    end
    newc = []; newn = {};
    for b = 1:size(c, 2)
        for a = 1:size(cols, 2)
            newc = [newc cols(:, a) .* c(:, b)];
            if isempty(names{a}), newn{end + 1} = nm{b}; else, newn{end + 1} = [names{a} ':' nm{b}]; end
        end
    end
    cols = newc; names = newn;
end
end

function c = fit_class(m)
if isstruct(m), c = 'ordinal';
elseif isa(m, 'GeneralizedLinearMixedModel'), c = 'glme';
elseif isa(m, 'LinearMixedModel'), c = 'lme';
else, c = 'glm';
end
end

function b = fit_coef(m)
switch fit_class(m)
    case 'ordinal', b = m.coef;
    case {'glme', 'lme'}, b = fixedEffects(m);
    otherwise, b = m.Coefficients.Estimate;
end
end

function V = fit_vcov(m)
switch fit_class(m)
    case 'ordinal', V = m.vcov;
    case {'glme', 'lme'}, V = m.CoefficientCovariance;
    otherwise, V = m.CoefficientCovariance;
end
end

function s = fit_se(m), s = sqrt(diag(fit_vcov(m))); end

function ll = fit_loglik(m)
% The log-likelihood as R reports it: fitglm's for the normal and gamma families uses the
% Pearson dispersion, where R's uses the maximum-likelihood one (deviance / n).
switch fit_class(m)
    case 'ordinal', ll = m.loglik;
    case 'glm'
        dist = lower(m.Distribution.Name);
        y = m.Fitted.Response + m.Residuals.Raw; mu = m.Fitted.Response; n = numel(y);
        if strcmp(dist, 'normal')
            ll = -0.5 * n * (log(2 * pi * m.Deviance / n) + 1);
        elseif strcmp(dist, 'gamma')
            disp_ml = m.Deviance / n;
            ll = sum(log(gampdf(y, 1 / disp_ml, mu * disp_ml)));
        else
            ll = m.LogLikelihood;
        end
    otherwise, ll = m.LogLikelihood;
end
end

function k = fit_k(m)
switch fit_class(m)
    case 'ordinal', k = numel(m.coef) + numel(m.zeta);
    case 'lme', k = numel(fixedEffects(m)) + n_covparams(m) + 1;
    case 'glme', k = numel(fixedEffects(m)) + n_covparams(m) + double(any(strcmpi(m.Distribution, {'Normal', 'Gamma'})));
    otherwise, k = numel(m.Coefficients.Estimate) + double(any(strcmpi(m.Distribution.Name, {'Normal', 'Gamma'})));
end
end

function k = n_covparams(m)
% The number of variance and covariance parameters of the random part.
psi = covarianceParameters(m);
k = 0;
for g = 1:numel(psi), q = size(psi{g}, 1); k = k + q * (q + 1) / 2; end
end

function d = fit_deviance(m)
switch fit_class(m)
    case 'ordinal', d = -2 * m.loglik;
    case {'glme', 'lme'}, d = -2 * m.LogLikelihood;
    otherwise, d = m.Deviance;
end
end

function d = fit_nulldev(m)
if strcmp(fit_class(m), 'glm')
    m0 = fitglm(m.Variables, [m.ResponseName ' ~ 1'], 'Distribution', m.Distribution.Name, 'Link', m.Link.Name);
    d = m0.Deviance;
else
    d = NaN;
end
end

function s = fit_dispersion(m)
switch fit_class(m)
    case 'glm', s = m.Dispersion;
    case 'lme', s = m.MSE;
    case 'glme'
        if strcmpi(m.Distribution, 'Gamma')
            % As lme4 estimates a gamma mixed model's dispersion: the penalized weighted residual
            % sum of squares over n, the Pearson chi-square plus the squared spherical random effects.
            pr = residuals(m, 'ResidualType', 'Pearson');
            s = (sum(pr.^2) + spherical_ss(m)) / numel(pr);
        else
            s = 1;
        end
    otherwise, s = 1;
end
end

function ss = spherical_ss(m)
% The squared length of the spherical random effects u = L \\ b, with L the Cholesky factor
% of each grouping factor's covariance, level by level.
[B, Bnames] = randomEffects(m);
psi = covarianceParameters(m);
grp = string(Bnames.Group); lev = string(Bnames.Level);
groups = unique(grp, 'stable');
ss = 0;
for g = 1:numel(groups)
    rows = grp == groups(g);
    L = chol(psi{g}, 'lower');
    levels = unique(lev(rows), 'stable');
    for l = 1:numel(levels)
        u = L \\ B(rows & lev == levels(l));
        ss = ss + u' * u;
    end
end
end

function f = fit_fitted(m)
switch fit_class(m)
    case 'ordinal', f = NaN(m.n, 1);
    case {'glme', 'lme'}, f = fitted(m);
    otherwise, f = m.Fitted.Response;
end
end

function z = fit_thresholds(m)
if strcmp(fit_class(m), 'ordinal'), z = m.zeta; else, z = []; end
end

function s = lrt_stat(full, red, family)
% The likelihood-ratio statistic of a term, as R's drop1(test = "Chisq") forms it.
if strcmp(fit_class(full), 'glm')
    if strcmp(family, 'normal'), s = full.NumObservations * log(red.Deviance / full.Deviance); return; end
    if strcmp(family, 'gamma'), s = (red.Deviance - full.Deviance) / full.Dispersion; return; end
    s = red.Deviance - full.Deviance; return;
end
s = 2 * (fit_loglik(full) - fit_loglik(red));
end

function red = fit_reduced(full, tbl, family, link, formula)
% The model without a term, refitted by maximum likelihood.
red = fit_model(tbl, family, link, formula, false);
end

function v = coef_at(m, name)
names = fit_coef_names(m); b = fit_coef(m);
v = b(strcmp(names, name));
if isempty(v), error('No coefficient named %s; the fit has %s.', name, strjoin(names, ', ')); end
end

function names = fit_coef_names(m)
switch fit_class(m)
    case 'ordinal', names = m.names;
    case {'glme', 'lme'}, names = m.CoefficientNames;
    otherwise, names = m.CoefficientNames;
end
end

function V = vcov_at(m, names)
% The covariance of the coefficients in the given order of names.
have = fit_coef_names(m); Vall = fit_vcov(m);
idx = zeros(1, numel(names));
for j = 1:numel(names), idx(j) = find(strcmp(have, names{j}), 1); end
V = Vall(idx, idx);
end

function v = se_at(m, name)
names = fit_coef_names(m); s = fit_se(m);
v = s(strcmp(names, name));
end

function m2 = fit_ml(m, tbl, family, link, formula)
% The model refitted by maximum likelihood (a REML mixed model is refitted).
if strcmp(fit_class(m), 'lme') && strcmp(m.FitMethod, 'REML')
    m2 = fit_model(tbl, family, link, formula, false);
else
    m2 = m;
end
end

function mu = linkinv_of(m, eta)
switch fit_class(m)
    case 'ordinal', mu = eta;
    case 'lme', mu = eta;
    case 'glme', mu = m.Link.Inverse(eta);
    otherwise, mu = m.Link.Inverse(eta);
end
end

function q = wald_quantile(alpha, df)
if isfinite(df), q = tinv(1 - alpha / 2, df); else, q = norminv(1 - alpha / 2); end
end

function a = fit_aux(m)
a = NaN;
end

function pr = pearson_residuals(m)
switch fit_class(m)
    case 'glm', pr = m.Residuals.Pearson;
    case 'glme', pr = residuals(m, 'ResidualType', 'Pearson');
    otherwise, pr = residuals(m);
end
pr = pr(~isnan(pr));
end

function vc = fit_varcomp(m)
% The random effects' variances, as a table with the group, the effect, and the value, from
% covarianceParameters.
vc = struct('grp', {{}}, 'eff', {{}}, 'value', [], 'corr', []);
if ~any(strcmp(fit_class(m), {'lme', 'glme'})), return; end
[psi, ~, st] = covarianceParameters(m);
for g = 1:numel(psi)
    P = psi{g};
    t = st{g};
    grp = char(t.Group(1));
    % The effect names: '(Intercept)' and the slope's variable.
    names = cellstr(t.Name1);
    for j = 1:size(P, 1)
        vc.grp{end + 1} = grp;
        if strcmp(names{j}, '(Intercept)'), vc.eff{end + 1} = '(Intercept)'; else, vc.eff{end + 1} = 'slope'; end
        vc.value(end + 1) = P(j, j);
    end
    if size(P, 1) == 2, vc.corr(end + 1) = P(1, 2) / sqrt(P(1, 1) * P(2, 2)); else, vc.corr(end + 1) = NaN; end
end
end

function v = varcomp_at(vc, term, effect)
v = NaN;
for i = 1:numel(vc.grp)
    if strcmp(vc.eff{i}, effect) && (strcmp(vc.grp{i}, term) || contains(term, vc.grp{i}) || contains(vc.grp{i}, term))
        v = vc.value(i); return;
    end
end
end

function v = varcomp_corr(vc, term)
v = NaN;
c = vc.corr(~isnan(vc.corr));
if ~isempty(c), v = c(1); end
end

function y = ordinal_codes(x, levels)
% The response's levels as 1..K, in the given order.
y = zeros(numel(x), 1);
for k = 1:numel(levels), y(strcmp(x(:), levels{k})) = k; end
end

function P = poly_columns(o)
% R's contr.poly columns for an ordinal categorical variable, one row per observation.
lv = categories(o);
P = poly_columns_at(o, o);
end

function P = poly_columns_at(o, ref)
% The polynomial contrast rows for the levels of o, with the contrasts defined on ref's levels.
lv = categories(ref);
k = numel(lv);
scores = (1:k)' - (k + 1) / 2;
C = zeros(k, k - 1);
for d = 1:k - 1
    v = scores.^d;
    for pass = 1:2
        v = v - mean(v);
        for q = 1:d - 1, v = v - (C(:, q)' * v) * C(:, q); end
    end
    C(:, d) = v / norm(v);
end
idx = zeros(numel(o), 1);
for j = 1:k, idx(o == lv{j}) = j; end
P = C(idx, :);
end
`;

LIB.m.grid = `
function X = grid_rows(m, tbl, newrows, names)
% The design rows of new data in the columns the given coefficient names give: a name is a
% product of pieces joined by ':', each a numeric variable or a dummy var_level.
vars = tbl.Properties.VariableNames;
n = height(newrows);
X = zeros(n, numel(names));
for j = 1:numel(names)
    nm = names{j};
    if strcmp(nm, '(Intercept)'), X(:, j) = 1; continue; end
    pieces = strsplit(nm, ':');
    col = ones(n, 1);
    for q = 1:numel(pieces)
        pc = pieces{q};
        hit = find(strcmp(vars, pc), 1);
        if ~isempty(hit)
            col = col .* double(newrows.(pc));
        else
            % var_level: the longest variable name that prefixes the piece.
            best = '';
            for v = 1:numel(vars)
                if startsWith(pc, [vars{v} '_']) && numel(vars{v}) > numel(best), best = vars{v}; end
            end
            lv = pc(numel(best) + 2:end);
            col = col .* double(string(newrows.(best)) == string(lv));
        end
    end
    X(:, j) = col;
end
end

`;

LIB.m.qresid = `
function r = quantile_residuals(y, mu, family, aux, u)
% Randomized quantile residuals on the normal scale (Dunn and Smyth).
y = y(:); mu = mu(:); u = u(:);
switch family
    case 'normal', p = normcdf(y, mu, sqrt(aux));
    case 'gamma', p = gamcdf(y, 1 / aux, mu * aux);
    case 'beta', p = betacdf(y, mu * aux, (1 - mu) * aux);
    case 'binomial'
        lo = (y > 0.5) .* (1 - mu); hi = (y > 0.5) + (y <= 0.5) .* (1 - mu); p = lo + u .* (hi - lo);
    case 'poisson'
        lo = poisscdf(y - 1, mu); hi = poisscdf(y, mu); p = lo + u .* (hi - lo);
    case 'negbin'
        pr = aux ./ (aux + mu);
        lo = nbincdf(y - 1, aux, pr); hi = nbincdf(y, aux, pr); p = lo + u .* (hi - lo);
end
p = min(1 - eps, max(eps, p));
r = norminv(p);
end
`;
